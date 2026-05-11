"""
kiba-scraper sidecar — FastAPI app for media URL discovery + article
body extraction.

  - /discover uses the ddgs package directly (no LLM in the loop).
    SearchGraph used to back this endpoint, but its pipeline runs a
    multi-step LLM chain — Playwright fetch each result page + N MLX
    synthesis calls per keyword — which burned 5-15 s per query and
    made the whole call hostage to MLX uptime. We don't need an LLM to
    list URLs; the downstream pipeline (keyword matcher + Tier 1/2)
    does the semantic work.
  - /extract still uses scrapegraphai's SmartScraperGraph against MLX.
    Pulling headline/body/date/author out of arbitrary publisher HTML
    is the part where the LLM genuinely earns its keep.

Talks to:
  - DuckDuckGo (and the other engines ddgs aggregates) over plain HTTP
  - The article publisher's site (Playwright fetch — /extract only)
  - MLX LLM at MLX_BASE_URL (OpenAI-compatible HTTPS — /extract only)

Three endpoints:
  POST /discover  — keyword queries → article URLs
  POST /extract   — article URL → {title, body, published_at, author}
  GET  /healthz   — readiness probe (MLX bearer reachable)

See ../scraper/schemas.py for the strict request/response shapes.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Optional

import httpx
from ddgs import DDGS
from fastapi import FastAPI, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from scrapegraphai.graphs import SmartScraperGraph

from schemas import (
    DiscoverRequest,
    DiscoverResponse,
    DiscoverStats,
    ExtractRequest,
    ExtractResponse,
    ExtractResult,
)

log = logging.getLogger("kiba-scraper")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))


# ---- config -----------------------------------------------------------

MLX_BASE_URL = os.environ["MLX_BASE_URL"]
MLX_API_KEY = os.environ["MLX_API_KEY"]
MLX_MODEL = os.getenv(
    "MLX_MODEL",
    "mlx-community/gemma-3-4b-it-4bit",
)

# scrapegraphai routes via langchain-openai's ChatOpenAI when the model
# name is prefixed with "openai/". The "openai/" prefix is stripped
# before the model name reaches the API (verified in the Day 0 stub).
#
# Do NOT add "model_tokens" here — newer scrapegraphai/langchain-openai
# leaks it through to OpenAI's Completions.create() as a kwarg, which
# raises "unexpected keyword argument 'model_tokens'" and kills every
# graph.run() before any I/O. The "Max input tokens for model X not
# found" warning it used to suppress is harmless.
#
# max_retries=0 disables the OpenAI client's default exponential
# back-off (60 s × 5 attempts per 5xx). When MLX returns a transient
# 502, we'd rather lose one query in milliseconds than stall the entire
# /discover loop for five minutes. max_retries is a first-class
# ChatOpenAI parameter so it doesn't leak through as an unknown kwarg.
_LLM_CONFIG = {
    "model": f"openai/{MLX_MODEL}",
    "api_key": MLX_API_KEY,
    "base_url": MLX_BASE_URL,
    "temperature": 0,
    "max_retries": 0,
}


def _graph_config(extra: Optional[dict] = None) -> dict:
    cfg = {
        "llm": dict(_LLM_CONFIG),
        "verbose": False,
        "headless": True,
    }
    if extra:
        cfg.update(extra)
    return cfg


# ---- readiness state --------------------------------------------------

_ready = {
    "mlx": False,
    "checked_at": 0.0,
}


_PROBE_TTL_SECONDS = 300.0


async def _probe_mlx(timeout_s: float = 5.0) -> bool:
    """GET the MLX /models endpoint with the bearer to confirm it's reachable
    and the token is accepted. Caller is responsible for caching."""
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as cli:
            r = await cli.get(
                MLX_BASE_URL.rstrip("/") + "/models",
                headers={"Authorization": f"Bearer {MLX_API_KEY}"},
            )
        return r.status_code < 500
    except Exception as exc:  # noqa: BLE001
        log.warning("MLX probe failed: %s", exc)
        return False


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("kiba-scraper starting; MLX_BASE_URL=%s, model=%s",
             MLX_BASE_URL, MLX_MODEL)
    _ready["mlx"] = await _probe_mlx()
    _ready["checked_at"] = time.time()
    yield


app = FastAPI(title="kiba-scraper", lifespan=lifespan)


# ---- endpoints --------------------------------------------------------


@app.get("/healthz")
async def healthz():
    # Compose's healthcheck interval is 60s; using a 60s TTL would let
    # clock-drift miss the cache ~50% of the time. 5 min is plenty for
    # an availability probe.
    if time.time() - _ready["checked_at"] > _PROBE_TTL_SECONDS:
        _ready["mlx"] = await _probe_mlx()
        _ready["checked_at"] = time.time()

    body = {
        "ok": _ready["mlx"],
        "mlx_reachable": _ready["mlx"],
        "model": MLX_MODEL,
    }
    if not _ready["mlx"]:
        return JSONResponse(body, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
    return body


def _ddgs_search(query: str, max_results: int) -> list[dict]:
    """Sync DDG search via the ddgs package. Called from asyncio.to_thread
    inside /discover so we don't block the event loop. ddgs aggregates
    several engines (DuckDuckGo HTML, Brave, Mojeek, Wikipedia) and
    returns one merged list of {title, href, body} dicts. region=no-no
    biases toward Norwegian-language results."""
    with DDGS() as ddg:
        return list(ddg.text(query, max_results=max_results, region="no-no"))


@app.post("/discover", response_model=DiscoverResponse)
async def discover(req: DiscoverRequest):
    started = time.time()
    urls: list[str] = []
    seen: set[str] = set()
    queries_run = 0
    dropped_off_domain = 0
    stopped = "completed"

    for term in req.queries:
        # Wall budget: a healthy ddgs call is ~0.5-2 s, so 20 keywords
        # comfortably fit under max_wall_seconds. The check fires
        # between iterations — that's accurate now because no single
        # iteration runs long enough to blow past the budget.
        if time.time() - started > req.max_wall_seconds:
            stopped = "wall_time"
            break
        cleaned = term.strip()
        q = f"site:{req.site} {cleaned}" if req.site else cleaned
        try:
            hits = await asyncio.to_thread(_ddgs_search, q, req.num_results)
        except Exception as exc:  # noqa: BLE001
            log.warning("ddgs failed for %r: %s", q, exc)
            stopped = "search_error"
            continue

        queries_run += 1
        for r in hits:
            url = r.get("href") if isinstance(r, dict) else None
            if not isinstance(url, str) or not url.startswith(("http://", "https://")):
                continue
            if req.site and req.site.lower() not in url.lower():
                # ddgs occasionally returns off-domain results even with
                # site: in the query (different engines vary in how
                # strictly they apply the operator).
                dropped_off_domain += 1
                continue
            if url in seen:
                continue
            seen.add(url)
            urls.append(url)

    duration_ms = int((time.time() - started) * 1000)
    return DiscoverResponse(
        urls=urls,
        stats=DiscoverStats(
            queries_run=queries_run,
            pages_fetched=len(urls),
            duration_ms=duration_ms,
            stopped=stopped,
            # result_shapes was SearchGraph diagnostics; ddgs results
            # are always {title, href, body} so the field is now empty
            # but kept for response-schema compat.
            result_shapes=[],
            dropped_off_domain=dropped_off_domain,
        ),
    )


@app.post("/extract", response_model=ExtractResponse)
async def extract(req: ExtractRequest):
    url = str(req.url)

    prompt = (
        "Extract from this news article: the headline (title), the full "
        "article body text (NOT the page chrome — exclude nav, footer, "
        "comments, related articles), the publication date as ISO 8601 "
        "if visible, and the author byline if visible. If the body is "
        "behind a paywall and only a teaser is shown, return the teaser. "
        "Do not invent or summarise — extract verbatim."
    )

    graph = SmartScraperGraph(
        prompt=prompt,
        source=url,
        schema=ExtractResult,
        config=_graph_config(),
    )

    try:
        raw = await asyncio.to_thread(graph.run)
    except Exception as exc:  # noqa: BLE001
        log.warning("SmartScraperGraph failed for %s: %s", url, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"scrapegraphai_error: {type(exc).__name__}: {exc}"[:300],
        )

    # Validate against ExtractResult — this is the gate that rejects
    # LLM hallucination (malformed dates, empty body, wrong types).
    try:
        validated = ExtractResult.model_validate(raw)
    except ValidationError as ve:
        log.info("Extract schema mismatch for %s: %s", url, ve.errors()[:3])
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "error": "schema_mismatch",
                "validation_errors": ve.errors()[:5],
                "raw_keys": list(raw.keys()) if isinstance(raw, dict) else None,
            },
        )

    return ExtractResponse(url=url, result=validated)
