import { describe, it, expect, beforeEach } from "vitest";
import { runMediaBackfill } from "./media-backfill.js";
import { _resetRateLimitForTests } from "./media-client.js";
import { _resetCache } from "./media-robots.js";

beforeEach(() => {
  _resetRateLimitForTests();
  _resetCache();
});

type SbCall = { path: string; init?: { method?: string; body?: unknown } };

function makeSb(handlers: { path: RegExp; method?: string; reply: unknown }[]) {
  const calls: SbCall[] = [];
  const sb = async (path: string, init: any = {}) => {
    calls.push({ path, init });
    const method = init?.method || "GET";
    for (const h of handlers) {
      if (h.path.test(path) && (!h.method || h.method === method)) {
        return typeof h.reply === "function"
          ? (h.reply as any)(path, init)
          : h.reply;
      }
    }
    return [];
  };
  return { sb, calls };
}

describe("runMediaBackfill", () => {
  it("throws when the source isn't found", async () => {
    const { sb } = makeSb([
      { path: /^\/media_sources\?id=eq\.missing/, reply: [] },
    ]);
    await expect(
      (runMediaBackfill as any)({ sb, sourceId: "missing" }),
    ).rejects.toThrow(/Fant ikke kilde/);
  });

  it("runs the search-adapter, enqueues new URLs, advances cursor, completes the job", async () => {
    const fetcher = async (url: string) => {
      if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
      if (url.includes("page=1")) {
        return new Response(
          '<a href="/artikkel/a-1">x</a><a href="/artikkel/a-2">y</a>',
          { status: 200, headers: { "content-type": "text/html" } },
        );
      }
      return new Response("", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    };

    let queueInsertBody: unknown[] = [];
    let cursorPatch: { backfill_cursor?: string } | null = null;
    let jobMeta: { metadata?: Record<string, unknown> } | null = null;

    const { sb } = makeSb([
      {
        path: /^\/media_sources\?id=eq\.src-1/,
        method: "GET",
        reply: [
          {
            id: "src-1",
            name: "Digi.no",
            domain: "digi.no",
            backfill_method: "site_search",
            search_config: {
              url_template: "https://digi.no/sok?q={q}&page={page}",
              max_pages_per_query: 2,
            },
            crawl_delay_ms: 100,
            backfill_cursor: null,
          },
        ],
      },
      {
        path: /^\/keywords/,
        method: "GET",
        reply: [{ term: "AI" }],
      },
      {
        path: /^\/jobs$/,
        method: "POST",
        reply: [{ id: "job-1" }],
      },
      {
        path: /^\/media_url_queue$/,
        method: "POST",
        reply: (_path: string, init: any) => {
          queueInsertBody = init.body as unknown[];
          // PostgREST with ignore-duplicates returns only the rows that
          // actually inserted (no conflict). Mock that fact.
          return queueInsertBody.map((r: any, i) => ({ id: `q-${i}`, ...r }));
        },
      },
      {
        path: /^\/media_sources\?id=eq\.src-1/,
        method: "PATCH",
        reply: (_path: string, init: any) => {
          cursorPatch = init.body;
          return null;
        },
      },
      {
        path: /^\/jobs\?id=eq\.job-1/,
        method: "PATCH",
        reply: (_path: string, init: any) => {
          jobMeta = init.body;
          return null;
        },
      },
    ]);

    const result = await (runMediaBackfill as any)({
      sb,
      sourceId: "src-1",
      fetcher,
    });

    expect(result.status).toBe("success");
    expect(result.urls_found).toBeGreaterThanOrEqual(2);
    expect(result.enqueued).toBe(2);
    expect(queueInsertBody).toHaveLength(2);
    expect((queueInsertBody[0] as { source_id: string }).source_id).toBe("src-1");
    expect((queueInsertBody[0] as { url_hash: string }).url_hash).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(cursorPatch?.backfill_cursor).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(jobMeta?.metadata?.urls_found).toBeGreaterThanOrEqual(2);
  });

  it("dispatches to the sitemap walker when backfill_method='sitemap'", async () => {
    const SITEMAP = `<?xml version="1.0"?>
      <urlset>
        <url><loc>https://example.no/artikkel/x-1</loc></url>
        <url><loc>https://example.no/artikkel/x-2</loc></url>
      </urlset>`;

    const fetcher = async (url: string) => {
      if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
      if (url.endsWith("/sitemap.xml"))
        return new Response(SITEMAP, {
          status: 200,
          headers: { "content-type": "application/xml" },
        });
      return new Response("", { status: 404 });
    };

    let queueInsertCount = 0;
    const { sb } = makeSb([
      {
        path: /^\/media_sources\?id=eq\.src-2/,
        method: "GET",
        reply: [
          {
            id: "src-2",
            name: "Example",
            domain: "example.no",
            backfill_method: "sitemap",
            sitemap_url: "https://example.no/sitemap.xml",
            sitemap_index: false,
            crawl_delay_ms: 100,
          },
        ],
      },
      { path: /^\/jobs$/, method: "POST", reply: [{ id: "job-2" }] },
      {
        path: /^\/media_url_queue$/,
        method: "POST",
        reply: (_path: string, init: any) => {
          queueInsertCount += (init.body as unknown[]).length;
          return init.body;
        },
      },
      { path: /^\/media_sources\?id=eq\.src-2/, method: "PATCH", reply: null },
      { path: /^\/jobs\?id=eq\.job-2/, method: "PATCH", reply: null },
    ]);

    const result = await (runMediaBackfill as any)({
      sb,
      sourceId: "src-2",
      fetcher,
    });
    expect(result.status).toBe("success");
    expect(result.backfill_method).toBe("sitemap");
    expect(queueInsertCount).toBe(2);
  });

  it("marks the job 'failed' when the search adapter throws", async () => {
    let failedBody: { status?: string; error?: string } | null = null;
    const { sb } = makeSb([
      {
        path: /^\/media_sources\?id=eq\.src-bad/,
        method: "GET",
        reply: [
          {
            id: "src-bad",
            name: "Bad",
            domain: "bad.no",
            backfill_method: "site_search",
            search_config: null, // missing
            crawl_delay_ms: 100,
          },
        ],
      },
      { path: /^\/keywords/, method: "GET", reply: [{ term: "AI" }] },
      { path: /^\/jobs$/, method: "POST", reply: [{ id: "job-3" }] },
      {
        path: /^\/jobs\?id=eq\.job-3/,
        method: "PATCH",
        reply: (_path: string, init: any) => {
          failedBody = init.body;
          return null;
        },
      },
    ]);

    await expect(
      (runMediaBackfill as any)({ sb, sourceId: "src-bad" }),
    ).rejects.toThrow(/search_config/);
    expect(failedBody?.status).toBe("failed");
    expect(failedBody?.error).toMatch(/search_config/);
  });

  it("re-running with already-queued URLs reports 0 new", async () => {
    const fetcher = async (url: string) => {
      if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
      return new Response('<a href="/artikkel/dup">x</a>', {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    };
    const { sb } = makeSb([
      {
        path: /^\/media_sources\?id=eq\.src-dup/,
        method: "GET",
        reply: [
          {
            id: "src-dup",
            name: "Dup",
            domain: "dup.no",
            backfill_method: "site_search",
            search_config: {
              url_template: "https://dup.no/sok?q={q}&page={page}",
              max_pages_per_query: 1,
            },
            crawl_delay_ms: 100,
          },
        ],
      },
      { path: /^\/keywords/, method: "GET", reply: [{ term: "AI" }] },
      { path: /^\/jobs$/, method: "POST", reply: [{ id: "job-4" }] },
      // ignore-duplicates: PostgREST returns [] when the row was a conflict.
      { path: /^\/media_url_queue$/, method: "POST", reply: [] },
      { path: /^\/media_sources\?id=eq\.src-dup/, method: "PATCH", reply: null },
      { path: /^\/jobs\?id=eq\.job-4/, method: "PATCH", reply: null },
    ]);

    const result = await (runMediaBackfill as any)({
      sb,
      sourceId: "src-dup",
      fetcher,
    });
    expect(result.urls_found).toBeGreaterThan(0);
    expect(result.enqueued).toBe(0);
  });
});
