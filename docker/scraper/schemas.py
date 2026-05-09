"""
Pydantic schemas for the kiba-scraper API.

These do double duty:
  1. FastAPI uses them for request/response validation.
  2. The /extract response schema is also passed to scrapegraphai's
     SmartScraperGraph as `schema=`, so the LLM is constrained to emit
     fields with the right names + types. If the LLM hallucinates dates
     or returns garbage, validation fails here and /extract returns 422
     with a "schema_mismatch" reason — kiba-web treats it as an
     extraction failure and falls back to the JSON-LD path.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, HttpUrl, field_validator


# ---- /discover ----------------------------------------------------------


class DiscoverRequest(BaseModel):
    queries: list[str] = Field(
        ..., min_length=1, max_length=20,
        description="Keyword terms to search for (from public.keywords).",
    )
    site: Optional[str] = Field(
        None,
        description="Optional domain filter, e.g. 'nrk.no'. When set, "
                    "prepends 'site:<domain>' to each query.",
    )
    num_results: int = Field(
        10, ge=1, le=50,
        description="Max URLs to return per query.",
    )

    @field_validator("queries")
    @classmethod
    def _strip_blanks(cls, v: list[str]) -> list[str]:
        out = [q.strip() for q in v if q and q.strip()]
        if not out:
            raise ValueError("queries: all entries were blank")
        return out


class DiscoverStats(BaseModel):
    queries_run: int
    pages_fetched: int
    duration_ms: int
    stopped: str = "completed"
    # Per-query top-level shape fingerprint of what SearchGraph.run()
    # returned, e.g. "keys=urls,answer" / "keys=result.urls" / "list[12]"
    # / "type=str". Lets an operator on /admin/processes/{id} see at a
    # glance whether the parser silently dropped a non-empty result.
    result_shapes: list[str] = Field(default_factory=list)
    # Count of URLs SearchGraph returned that we dropped because they
    # didn't match the requested site filter. Distinguishes "search
    # found nothing" from "found things, all off-domain".
    dropped_off_domain: int = 0


class DiscoverResponse(BaseModel):
    urls: list[str]
    stats: DiscoverStats


# ---- /extract ----------------------------------------------------------


class ExtractRequest(BaseModel):
    url: HttpUrl


class ExtractResult(BaseModel):
    """
    The schema we hand to SmartScraperGraph. Field names match what we
    want stored on `media_articles`. All optional except `body` — an
    empty body means extraction failed; we'd rather return 422 than
    insert a row with no content.
    """

    title: Optional[str] = Field(None, max_length=500)
    body: str = Field(..., min_length=200)
    published_at: Optional[datetime] = Field(
        None,
        description="ISO 8601 publication date if visible on the page.",
    )
    author: Optional[str] = Field(None, max_length=200)

    @field_validator("body")
    @classmethod
    def _body_not_whitespace(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("body: only whitespace")
        return v


class ExtractResponse(BaseModel):
    url: str
    result: ExtractResult


# ---- error ----------------------------------------------------------


class ErrorResponse(BaseModel):
    error: str
    detail: Optional[str] = None
