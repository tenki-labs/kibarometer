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
from urllib.parse import urlparse

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
_LLM_CONFIG = {
    "model": f"openai/{MLX_MODEL}",
    "api_key": MLX_API_KEY,
    "base_url": MLX_BASE_URL,
    "temperature": 0,
    # Suppresses the "Max input tokens for model X not found" warning;
    # 8192 is conservative for Gemma 3 (real ctx is 128K) and covers
    # any single article page we'd extract from.
    "model_tokens": 8192,
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


async def _probe_mlx(timeout_s: float = 5.0) -> bool:
    """HEAD the MLX endpoint with the bearer to confirm it's reachable
    and the token is accepted. Caches the result for 60s — the probe
    runs cheaply so don't let healthz hammer it."""
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


# ---- helpers ----------------------------------------------------------


def _outlet_domain(url: str) -> Optional[str]:
    try:
        host = urlparse(url).hostname or ""
        return host.removeprefix("www.") if host else None
    except Exception:  # noqa: BLE001
        return None


def _build_query(term: str, site: Optional[str]) -> str:
    term = term.strip()
    if site:
        return f"site:{site} {term}"
    return term


# ---- endpoints --------------------------------------------------------


@app.get("/healthz")
async def healthz():
    # Cache the MLX probe for 60s.
    if time.time() - _ready["checked_at"] > 60:
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


@app.post("/discover", response_model=DiscoverResponse)
async def discover(req: DiscoverRequest):
    started = time.time()
    urls: list[str] = []
    seen: set[str] = set()
    pages_fetched = 0
    queries_run = 0
    stopped = "completed"

    for term in req.queries:
        q = _build_query(term, req.site)
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
        # SearchGraph's result shape varies — sometimes {"urls": [...]},
        # sometimes a list, sometimes nested. Be forgiving.
        candidates: list[str] = []
        if isinstance(result, dict):
            if isinstance(result.get("urls"), list):
                candidates = [str(u) for u in result["urls"]]
            elif isinstance(result.get("result"), list):
                candidates = [str(u) for u in result["result"]]
        elif isinstance(result, list):
            candidates = [str(u) for u in result]

        for u in candidates:
            if not u.startswith(("http://", "https://")):
                continue
            if req.site and req.site.lower() not in u.lower():
                # Defensive: SearchGraph occasionally returns off-domain
                # results despite the site: filter.
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
