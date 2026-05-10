import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockDiscoverUrls } = vi.hoisted(() => ({
  mockDiscoverUrls: vi.fn(),
}));
vi.mock("./media-scraper-client.js", () => ({
  discoverUrls: mockDiscoverUrls,
}));

import { runMediaBackfill } from "./media-backfill.js";
import { _resetRateLimitForTests } from "./media-client.js";
import { _resetCache } from "./media-robots.js";

beforeEach(() => {
  _resetRateLimitForTests();
  _resetCache();
  mockDiscoverUrls.mockReset();
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

  it("runs the scrapegraph adapter, enqueues new URLs, advances cursor, completes the job", async () => {
    mockDiscoverUrls.mockResolvedValue({
      urls: [
        "https://example.no/artikkel/a-1",
        "https://example.no/artikkel/a-2",
      ],
      stats: { queries_run: 1, pages_fetched: 1, duration_ms: 1234, stopped: "completed" },
    });

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
            name: "Example",
            domain: "example.no",
            crawl_delay_ms: 100,
            backfill_cursor: null,
          },
        ],
      },
      { path: /^\/keywords/, method: "GET", reply: [{ term: "AI" }] },
      { path: /^\/jobs$/, method: "POST", reply: [{ id: "job-1" }] },
      {
        path: /^\/media_url_queue$/,
        method: "POST",
        reply: (_path: string, init: any) => {
          queueInsertBody = init.body as unknown[];
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

    const result = await (runMediaBackfill as any)({ sb, sourceId: "src-1" });

    expect(result.status).toBe("success");
    expect(result.urls_found).toBe(2);
    expect(result.enqueued).toBe(2);
    expect(mockDiscoverUrls).toHaveBeenCalledWith({
      queries: ["AI"],
      site: "example.no",
      numResults: 10,
    });
    expect(queueInsertBody).toHaveLength(2);
    expect((queueInsertBody[0] as { source_id: string }).source_id).toBe("src-1");
    expect((queueInsertBody[0] as { url_hash: string }).url_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(cursorPatch?.backfill_cursor).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(jobMeta?.metadata?.urls_found).toBe(2);
  });

  it("marks the job 'failed' when scrapegraph throws", async () => {
    mockDiscoverUrls.mockRejectedValue(new Error("kiba-scraper /discover → 500: boom"));

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
            crawl_delay_ms: 100,
          },
        ],
      },
      { path: /^\/keywords/, method: "GET", reply: [{ term: "AI" }] },
      { path: /^\/jobs$/, method: "POST", reply: [{ id: "job-bad" }] },
      {
        path: /^\/jobs\?id=eq\.job-bad/,
        method: "PATCH",
        reply: (_path: string, init: any) => {
          failedBody = init.body;
          return null;
        },
      },
    ]);

    await expect(
      (runMediaBackfill as any)({ sb, sourceId: "src-bad" }),
    ).rejects.toThrow(/kiba-scraper/);
    expect(failedBody?.status).toBe("failed");
    expect(failedBody?.error).toMatch(/kiba-scraper/);
  });

  it("re-running with already-queued URLs reports 0 new", async () => {
    mockDiscoverUrls.mockResolvedValue({
      urls: ["https://dup.no/artikkel/dup"],
      stats: { queries_run: 1, pages_fetched: 1, duration_ms: 100, stopped: "completed" },
    });

    const { sb } = makeSb([
      {
        path: /^\/media_sources\?id=eq\.src-dup/,
        method: "GET",
        reply: [
          {
            id: "src-dup",
            name: "Dup",
            domain: "dup.no",
            crawl_delay_ms: 100,
          },
        ],
      },
      { path: /^\/keywords/, method: "GET", reply: [{ term: "AI" }] },
      { path: /^\/jobs$/, method: "POST", reply: [{ id: "job-dup" }] },
      // ignore-duplicates: PostgREST returns [] when the row was a conflict.
      { path: /^\/media_url_queue$/, method: "POST", reply: [] },
      { path: /^\/media_sources\?id=eq\.src-dup/, method: "PATCH", reply: null },
      { path: /^\/jobs\?id=eq\.job-dup/, method: "PATCH", reply: null },
    ]);

    const result = await (runMediaBackfill as any)({ sb, sourceId: "src-dup" });
    expect(result.urls_found).toBe(1);
    expect(result.enqueued).toBe(0);
  });
});
