"""
kiba-scraper sidecar — FastAPI wrapper around scrapegraphai's
SearchGraph (URL discovery) and SmartScraperGraph (article extraction).

Talks only to:
  - DuckDuckGo (search backend, free, bundled with scrapegraphai)
  - The article publisher's site (Playwright fetch)
  - MLX LLM at MLX_BASE_URL (OpenAI-compatible HTTPS, bearer token)

Three endpoints:
  POST /discover  — keyword queries → article URLs
  POST /extract   — article URL → {title, body, published_at, author}
  GET  /healthz   — readiness probe (LLM + Chromium handshake)

See ../scraper/schemas.py for the strict request/response shapes that
double as scrapegraphai output validation.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from scrapegraphai.graphs import SearchGraph, SmartScraperGraph

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
_LLM_CONFIG = {
    "model": f"openai/{MLX_MODEL}",
    "api_key": MLX_API_KEY,
    "base_url": MLX_BASE_URL,
    "temperature": 0,
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


def _shape_of(result: object) -> str:
    """One-line fingerprint of what SearchGraph.run() returned, surfaced
    in DiscoverStats.result_shapes so an operator on /admin/processes/{id}
    can tell at a glance whether the parser silently dropped a non-empty
    result. Examples:
      "keys=urls"
      "keys=answer,considered_urls"
      "list[12]"
      "type=str"
    """
    if isinstance(result, dict):
        keys = sorted(result.keys()) if result else []
        return "keys=" + ",".join(keys) if keys else "keys=<empty>"
    if isinstance(result, list):
        return f"list[{len(result)}]"
    return f"type={type(result).__name__}"


def _extract_candidates(result: object) -> list[str]:
    """Pull URL strings out of whatever SearchGraph returned. Handles the
    handful of shapes observed in scrapegraphai 1.76. If a new shape
    appears in /admin/processes/{id}'s metadata.result_shapes, add it
    here AND to test_server.py so the parser doesn't silently regress."""
    if isinstance(result, dict):
        for key in ("urls", "links", "considered_urls"):
            v = result.get(key)
            if isinstance(v, list):
                return [str(u) for u in v]
        for outer in ("result", "answer"):
            inner = result.get(outer)
            if isinstance(inner, list):
                return [str(u) for u in inner]
            if isinstance(inner, dict):
                for key in ("urls", "links", "considered_urls"):
                    v = inner.get(key)
                    if isinstance(v, list):
                        return [str(u) for u in v]
    elif isinstance(result, list):
        return [str(u) for u in result]
    return []


@app.post("/discover", response_model=DiscoverResponse)
async def discover(req: DiscoverRequest):
    started = time.time()
    urls: list[str] = []
    seen: set[str] = set()
    pages_fetched = 0
    queries_run = 0
    dropped_off_domain = 0
    result_shapes: list[str] = []
    stopped = "completed"

    for term in req.queries:
        cleaned = term.strip()
        q = f"site:{req.site} {cleaned}" if req.site else cleaned
        prompt = (
            f"Find recent Norwegian news articles matching: {q}. "
            "Return ONLY a JSON object with a 'urls' array of full "
            "publisher URLs (one per article). Do not invent URLs."
        )
        graph = SearchGraph(
            prompt=prompt,
            config=_graph_config({"max_results": req.num_results}),
        )
        try:
            # scrapegraphai's run() is sync; offload to a thread so we
            # don't block the event loop.
            result = await asyncio.to_thread(graph.run)
        except Exception as exc:  # noqa: BLE001
            log.warning("SearchGraph failed for %r: %s", q, exc)
            stopped = "search_error"
            continue

        queries_run += 1
        shape = _shape_of(result)
        result_shapes.append(shape)
        candidates = _extract_candidates(result)

        if not candidates and result not in (None, {}, []):
            # Non-empty result that the parser couldn't read. Log the
            # raw value so it's visible in `docker logs kiba-scraper`,
            # capped at 500 chars.
            log.info(
                "SearchGraph returned shape=%s but no URLs parsed for %r: %s",
                shape, q, repr(result)[:500],
            )

        for u in candidates:
            if not u.startswith(("http://", "https://")):
                continue
            if req.site and req.site.lower() not in u.lower():
                # Defensive: SearchGraph occasionally returns off-domain
                # results despite the site: filter.
                dropped_off_domain += 1
                continue
            if u in seen:
                continue
            seen.add(u)
            urls.append(u)
            pages_fetched += 1

    duration_ms = int((time.time() - started) * 1000)
    return DiscoverResponse(
        urls=urls,
        stats=DiscoverStats(
            queries_run=queries_run,
            pages_fetched=pages_fetched,
            duration_ms=duration_ms,
            stopped=stopped,
            result_shapes=result_shapes,
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
