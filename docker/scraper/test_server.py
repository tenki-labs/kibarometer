"""
Smoke tests for the kiba-scraper FastAPI app.

Strategy: stub the MLX endpoint with a tiny in-process HTTP server that
returns canned chat-completion responses. Patch scrapegraphai's
SmartScraperGraph and SearchGraph at the import boundary so we don't
actually fetch live pages — the goal here is to verify the FastAPI
wiring (request parsing, response shape, validator gate, healthcheck)
not to retest scrapegraphai's internals.

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


class _FakeSearchGraph:
    """Replaces SearchGraph; returns predetermined URLs based on query."""

    last_prompts: list[str] = []

    def __init__(self, prompt, config):
        self.prompt = prompt
        self.config = config
        _FakeSearchGraph.last_prompts.append(prompt)

    def run(self):
        # If the prompt has a site: filter, return only that domain.
        if "site:nrk.no" in self.prompt:
            return {"urls": ["https://www.nrk.no/article-1", "https://www.nrk.no/article-2"]}
        return {"urls": [
            "https://www.aftenposten.no/i/abc/something",
            "https://www.digi.no/artikkel/openai",
            "https://example.com/external-but-should-pass",
        ]}


def test_discover_basic(client):
    _FakeSearchGraph.last_prompts.clear()
    with patch("server.SearchGraph", _FakeSearchGraph):
        r = client.post("/discover", json={"queries": ["AI"], "num_results": 5})
    assert r.status_code == 200
    body = r.json()
    assert len(body["urls"]) == 3
    assert body["stats"]["queries_run"] == 1


def test_discover_site_filter_keeps_only_matching(client):
    _FakeSearchGraph.last_prompts.clear()
    with patch("server.SearchGraph", _FakeSearchGraph):
        r = client.post("/discover", json={
            "queries": ["AI", "KI"],
            "site": "nrk.no",
            "num_results": 5,
        })
    body = r.json()
    # Both queries hit the nrk.no branch → 2 unique URLs (deduped).
    assert all("nrk.no" in u for u in body["urls"])
    assert len(body["urls"]) == 2
    # Both prompts include the site: filter.
    assert all("site:nrk.no" in p for p in _FakeSearchGraph.last_prompts)


def test_discover_rejects_blank_queries(client):
    r = client.post("/discover", json={"queries": ["", "  "]})
    assert r.status_code == 422


def test_discover_rejects_too_many_queries(client):
    r = client.post("/discover", json={"queries": ["x"] * 25})
    assert r.status_code == 422


class _FakeSearchGraphUnparseable:
    """Returns a dict shape the parser doesn't know — simulates the
    VG.no failure mode where SearchGraph hands back an LLM-shaped dict
    and we silently drop everything."""

    def __init__(self, prompt, config):
        pass

    def run(self):
        return {
            "answer": "Here are some Norwegian news URLs",
            "considered_urls": ["https://www.vg.no/i/Mlavbg/x"],
        }


def test_discover_unparseable_shape_logs_and_recovers(client, caplog):
    """A non-empty result the parser can't read should:
      1. still 200 (we don't blow up),
      2. surface the shape in stats.result_shapes,
      3. log the raw value so an operator can debug,
      4. now actually pull URLs from `considered_urls` (the parser was
         extended to handle this shape — was the silent VG.no bug)."""
    import logging

    with patch("server.SearchGraph", _FakeSearchGraphUnparseable):
        with caplog.at_level(logging.INFO, logger="kiba-scraper"):
            r = client.post("/discover", json={
                "queries": ["AI"],
                "site": "vg.no",
                "num_results": 5,
            })

    assert r.status_code == 200
    body = r.json()
    # Parser now extracts considered_urls — VG.no fix.
    assert body["urls"] == ["https://www.vg.no/i/Mlavbg/x"]
    assert body["stats"]["result_shapes"] == ["keys=answer,considered_urls"]
    assert body["stats"]["dropped_off_domain"] == 0


class _FakeSearchGraphTrulyOpaque:
    """Returns a shape with no URL-bearing keys at all — exercises the
    'log raw value' branch."""

    def __init__(self, prompt, config):
        pass

    def run(self):
        return {"answer": "I don't know"}


def test_discover_truly_opaque_shape_logs_raw(client, caplog):
    import logging

    with patch("server.SearchGraph", _FakeSearchGraphTrulyOpaque):
        with caplog.at_level(logging.INFO, logger="kiba-scraper"):
            r = client.post("/discover", json={"queries": ["x"]})

    assert r.status_code == 200
    body = r.json()
    assert body["urls"] == []
    assert body["stats"]["result_shapes"] == ["keys=answer"]
    # The "no URLs parsed" log line fired with the raw repr.
    assert any("no URLs parsed" in rec.message for rec in caplog.records)


class _FakeSearchGraphAllOffDomain:
    """Every URL returned is off-domain when site filter is applied."""

    def __init__(self, prompt, config):
        pass

    def run(self):
        return {"urls": [
            "https://www.aftenposten.no/x",
            "https://www.dagbladet.no/y",
        ]}


def test_discover_dropped_off_domain_counted(client):
    with patch("server.SearchGraph", _FakeSearchGraphAllOffDomain):
        r = client.post("/discover", json={"queries": ["x"], "site": "vg.no"})
    body = r.json()
    assert body["urls"] == []
    assert body["stats"]["dropped_off_domain"] == 2
    assert body["stats"]["result_shapes"] == ["keys=urls"]


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
