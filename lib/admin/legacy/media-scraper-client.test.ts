import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  discoverUrls,
  extractArticle,
  scraperHealthz,
} from "./media-scraper-client.js";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_SCRAPER_URL = process.env.SCRAPER_URL;

beforeEach(() => {
  process.env.SCRAPER_URL = "http://kiba-scraper:8000";
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_SCRAPER_URL == null) delete process.env.SCRAPER_URL;
  else process.env.SCRAPER_URL = ORIGINAL_SCRAPER_URL;
});

function mockFetchOnce(opts: { status?: number; body: unknown }) {
  const status = opts.status ?? 200;
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify(opts.body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

describe("discoverUrls", () => {
  it("posts to /discover and returns {urls, stats}", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : (input as Request).url ?? String(input);
      expect(url).toBe("http://kiba-scraper:8000/discover");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        queries: ["AI", "KI"],
        site: "nrk.no",
        num_results: 5,
      });
      return new Response(
        JSON.stringify({
          urls: ["https://www.nrk.no/a", "https://www.nrk.no/b"],
          stats: { queries_run: 2, pages_fetched: 2, duration_ms: 500, stopped: "completed" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const out = await discoverUrls({ queries: ["AI", "KI"], site: "nrk.no", numResults: 5 });
    expect(out.urls).toHaveLength(2);
    expect(out.stats.queries_run).toBe(2);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("throws when SCRAPER_URL is unset", async () => {
    delete process.env.SCRAPER_URL;
    await expect(discoverUrls({ queries: ["AI"] })).rejects.toThrow(/SCRAPER_URL/);
  });

  it("throws on empty queries arg", async () => {
    await expect(discoverUrls({ queries: [] })).rejects.toThrow(/queries/);
  });

  it("surfaces non-2xx responses with status + detail", async () => {
    mockFetchOnce({ status: 500, body: { detail: "scraper exploded" } });
    const promise = discoverUrls({ queries: ["AI"] });
    await expect(promise).rejects.toThrow(/500/);
    await expect(promise).rejects.toThrow(/scraper exploded/);
  });

  // The sidecar grew DiscoverStats.result_shapes + dropped_off_domain
  // for diagnosing 0-URL outcomes. The client doesn't filter stats — it
  // hands the whole stats blob to the orchestrator, which spreads it
  // into jobs.metadata so /admin/processes/{id} can render it. This
  // test guards that pass-through.
  it("passes diagnostic stats fields through unchanged", async () => {
    mockFetchOnce({
      status: 200,
      body: {
        urls: [],
        stats: {
          queries_run: 2,
          pages_fetched: 0,
          duration_ms: 689,
          stopped: "completed",
          result_shapes: ["keys=answer,considered_urls", "keys=answer"],
          dropped_off_domain: 0,
        },
      },
    });
    const out = await discoverUrls({ queries: ["AI", "KI"], site: "vg.no" });
    expect(out.urls).toEqual([]);
    expect((out.stats as { result_shapes: string[] }).result_shapes).toEqual([
      "keys=answer,considered_urls",
      "keys=answer",
    ]);
    expect((out.stats as { dropped_off_domain: number }).dropped_off_domain).toBe(0);
  });
});

describe("extractArticle", () => {
  it("posts to /extract and returns the normalised record", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          url: "https://www.digi.no/x",
          result: {
            title: "AI tar over",
            body: "x".repeat(300),
            published_at: "2026-05-01T08:30:00+02:00",
            author: "Ola Nordmann",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const out = await extractArticle("https://www.digi.no/x");
    expect(out.title).toBe("AI tar over");
    expect(out.author).toBe("Ola Nordmann");
    expect(out.published_at).toBe("2026-05-01T08:30:00+02:00");
  });

  it("attaches status=422 on schema_mismatch so caller can fall back", async () => {
    mockFetchOnce({
      status: 422,
      body: { detail: { error: "schema_mismatch", validation_errors: [] } },
    });
    try {
      await extractArticle("https://www.digi.no/x");
      throw new Error("expected throw");
    } catch (err) {
      const e = err as { status?: number; detail?: unknown };
      expect(e.status).toBe(422);
      expect((e.detail as { error?: string }).error).toBe("schema_mismatch");
    }
  });

  it("attaches status=502 on upstream scrapegraphai crash", async () => {
    mockFetchOnce({
      status: 502,
      body: { detail: "scrapegraphai_error: RuntimeError: Playwright timeout" },
    });
    try {
      await extractArticle("https://www.digi.no/x");
      throw new Error("expected throw");
    } catch (err) {
      const e = err as { status?: number };
      expect(e.status).toBe(502);
    }
  });

  it("requires a non-empty url", async () => {
    await expect(extractArticle("")).rejects.toThrow(/url/);
  });
});

describe("scraperHealthz", () => {
  it("returns ok=true on 200", async () => {
    mockFetchOnce({ status: 200, body: { ok: true, mlx_reachable: true, model: "gemma-3-4b" } });
    const out = await scraperHealthz();
    expect(out.ok).toBe(true);
    expect(out.status).toBe(200);
    expect(out.body?.mlx_reachable).toBe(true);
  });

  it("returns ok=false on 503", async () => {
    mockFetchOnce({ status: 503, body: { ok: false, mlx_reachable: false } });
    const out = await scraperHealthz();
    expect(out.ok).toBe(false);
    expect(out.status).toBe(503);
  });

  it("returns ok=false when sidecar is unreachable", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const out = await scraperHealthz();
    expect(out.ok).toBe(false);
    expect(out.status).toBe(0);
    expect(out.error).toMatch(/fetch failed/);
  });
});
