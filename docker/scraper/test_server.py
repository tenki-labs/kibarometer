"""
Smoke tests for the kiba-scraper FastAPI app.

Strategy: patch DDGS at the import boundary so /discover doesn't hit
the live search backends, and patch SmartScraperGraph so /extract
doesn't drive Playwright or MLX. The goal is to verify the FastAPI
wiring (request parsing, response shape, validator gate, healthcheck)
not to retest ddgs or scrapegraphai's internals.

Run: pytest test_server.py -v
"""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

# Required env before importing server.
os.environ.setdefault("MLX_BASE_URL", "http://stub.invalid/v1")
os.environ.setdefault("MLX_API_KEY", "tnk_test_token")
os.environ.setdefault("MLX_MODEL", "mlx-community/gemma-3-4b-it-4bit")


@pytest.fixture
def client():
    # Patch the MLX probe to always succeed so /healthz returns 200
    # without an actual network call.
    with patch("server._probe_mlx", return_value=True):
        from server import app
        with TestClient(app) as c:
            yield c


# ---- /healthz ----------------------------------------------------------


def test_healthz_ok(client):
    r = client.get("/healthz")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["mlx_reachable"] is True
    assert body["model"]


# ---- /discover ----------------------------------------------------------


def _stub_ddgs(per_query_hits):
    """Build a patcher for server._ddgs_search that returns a canned list
    of {href, title, body} dicts for every query. `per_query_hits` can be
    either a list (same hits for every query) or a callable
    `(query, max_results) -> list` for query-dependent behaviour."""
    if callable(per_query_hits):
        return patch("server._ddgs_search", side_effect=per_query_hits)
    return patch("server._ddgs_search", return_value=list(per_query_hits))


def test_discover_basic(client):
    hits = [
        {"href": "https://www.aftenposten.no/i/abc/something",
         "title": "AI", "body": ""},
        {"href": "https://www.digi.no/artikkel/openai",
         "title": "OpenAI", "body": ""},
        {"href": "https://example.com/external-but-should-pass",
         "title": "x", "body": ""},
    ]
    with _stub_ddgs(hits):
        r = client.post("/discover", json={"queries": ["AI"], "num_results": 5})
    assert r.status_code == 200
    body = r.json()
    assert len(body["urls"]) == 3
    assert body["stats"]["queries_run"] == 1
    assert body["stats"]["pages_fetched"] == 3


def test_discover_site_filter_keeps_only_matching(client):
    calls: list[tuple[str, int]] = []

    def by_query(query, max_results):
        calls.append((query, max_results))
        return [
            {"href": "https://www.nrk.no/article-1", "title": "", "body": ""},
            {"href": "https://www.nrk.no/article-2", "title": "", "body": ""},
        ]

    with _stub_ddgs(by_query):
        r = client.post("/discover", json={
            "queries": ["AI", "KI"],
            "site": "nrk.no",
            "num_results": 5,
        })

    body = r.json()
    # Same two URLs across both queries → deduped to 2.
    assert all("nrk.no" in u for u in body["urls"])
    assert len(body["urls"]) == 2
    # Both queries are prefixed with site: in the search string we pass
    # through to ddgs.
    assert all(q.startswith("site:nrk.no ") for q, _ in calls)


def test_discover_rejects_blank_queries(client):
    r = client.post("/discover", json={"queries": ["", "  "]})
    assert r.status_code == 422


def test_discover_rejects_too_many_queries(client):
    r = client.post("/discover", json={"queries": ["x"] * 25})
    assert r.status_code == 422


def test_discover_dropped_off_domain_counted(client):
    hits = [
        {"href": "https://www.aftenposten.no/x", "title": "", "body": ""},
        {"href": "https://www.dagbladet.no/y", "title": "", "body": ""},
    ]
    with _stub_ddgs(hits):
        r = client.post("/discover", json={"queries": ["x"], "site": "vg.no"})
    body = r.json()
    assert body["urls"] == []
    assert body["stats"]["dropped_off_domain"] == 2
    # result_shapes is preserved as an empty list for schema compat now
    # that we don't parse arbitrary SearchGraph shapes anymore.
    assert body["stats"]["result_shapes"] == []


def test_discover_search_error_continues_to_next_query(client):
    """One ddgs failure shouldn't kill the whole batch — surface
    stopped='search_error' but keep processing remaining keywords."""
    calls: list[str] = []

    def flake(query, max_results):
        calls.append(query)
        if "AI" in query:
            raise RuntimeError("ddgs network glitch")
        return [{"href": "https://www.nrk.no/x", "title": "", "body": ""}]

    with _stub_ddgs(flake):
        r = client.post("/discover", json={
            "queries": ["AI", "KI"], "site": "nrk.no", "num_results": 5,
        })

    assert r.status_code == 200
    body = r.json()
    assert body["urls"] == ["https://www.nrk.no/x"]
    assert body["stats"]["queries_run"] == 1  # KI succeeded, AI didn't
    assert body["stats"]["stopped"] == "search_error"
    assert len(calls) == 2  # both queries attempted


# ---- /extract ----------------------------------------------------------


class _FakeSmartGraphOk:
    def __init__(self, prompt, source, schema, config):
        self.source = source

    def run(self):
        return {
            "title": "AI tar over",
            "body": (
                "Dette er en lang tekst som er minst 200 tegn lang for å "
                "passere body-min-length-validatoren. " * 4
            ),
            "published_at": "2026-05-01T08:30:00+02:00",
            "author": "Ola Nordmann",
        }


class _FakeSmartGraphHallucinatedDate:
    """LLM returns a date string Pydantic can't parse."""

    def __init__(self, prompt, source, schema, config):
        pass

    def run(self):
        return {
            "title": "test",
            "body": "x" * 250,
            "published_at": "yesterday at noon",  # Not ISO 8601.
            "author": None,
        }


class _FakeSmartGraphEmptyBody:
    def __init__(self, prompt, source, schema, config):
        pass

    def run(self):
        return {"title": "test", "body": "", "published_at": None, "author": None}


class _FakeSmartGraphCrashes:
    def __init__(self, prompt, source, schema, config):
        pass

    def run(self):
        raise RuntimeError("Playwright timeout")


def test_extract_ok(client):
    with patch("server.SmartScraperGraph", _FakeSmartGraphOk):
        r = client.post("/extract", json={"url": "https://www.digi.no/x"})
    assert r.status_code == 200
    body = r.json()
    assert body["url"] == "https://www.digi.no/x"
    assert body["result"]["title"] == "AI tar over"
    assert body["result"]["author"] == "Ola Nordmann"
    assert body["result"]["published_at"].startswith("2026-05-01")


def test_extract_422_on_hallucinated_date(client):
    with patch("server.SmartScraperGraph", _FakeSmartGraphHallucinatedDate):
        r = client.post("/extract", json={"url": "https://www.digi.no/x"})
    assert r.status_code == 422
    body = r.json()
    assert body["detail"]["error"] == "schema_mismatch"


def test_extract_422_on_empty_body(client):
    with patch("server.SmartScraperGraph", _FakeSmartGraphEmptyBody):
        r = client.post("/extract", json={"url": "https://www.digi.no/x"})
    assert r.status_code == 422


def test_extract_502_on_scrapegraphai_crash(client):
    with patch("server.SmartScraperGraph", _FakeSmartGraphCrashes):
        r = client.post("/extract", json={"url": "https://www.digi.no/x"})
    assert r.status_code == 502
    assert "scrapegraphai_error" in r.json()["detail"]


def test_extract_rejects_non_url(client):
    r = client.post("/extract", json={"url": "not-a-url"})
    assert r.status_code == 422
