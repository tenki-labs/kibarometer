import { describe, it, expect, beforeEach } from "vitest";
import { assignWireCluster, runFetchClassify } from "./media-fetch-classify.js";
import { _resetRateLimitForTests } from "./media-client.js";
import { _resetCache } from "./media-robots.js";
import { simhash, toPgBigint, fnv1a64 } from "./media-simhash.js";

beforeEach(() => {
  _resetRateLimitForTests();
  _resetCache();
});

// --- Stubbed sb factory ---
type SbCall = { path: string; init?: { method?: string; body?: unknown } };

function makeSb(handlers: { path: RegExp; method?: string; reply: unknown }[]) {
  const calls: SbCall[] = [];
  const sb = async (path: string, init: any = {}) => {
    calls.push({ path, init });
    const method = init?.method || "GET";
    for (const h of handlers) {
      if (h.path.test(path) && (!h.method || h.method === method)) {
        return typeof h.reply === "function" ? (h.reply as any)(path, init) : h.reply;
      }
    }
    return [];
  };
  return { sb, calls };
}

describe("assignWireCluster", () => {
  it("returns null when no candidates fall in the ±24h window", async () => {
    const { sb } = makeSb([{ path: /^\/media_articles\?/, reply: [] }]);
    const sim = simhash("AI changes the world");
    const r = await assignWireCluster(sb as any, {
      simhash: toPgBigint(sim),
      published_at: "2026-04-15T08:00:00Z",
    });
    expect(r).toBeNull();
  });

  it("adopts existing wire_cluster_id when a candidate matches with one set", async () => {
    const ours = simhash(
      "Regjeringen lanserer ny strategi for kunstig intelligens i offentlig sektor",
    );
    const theirs = simhash(
      "Regjeringen presenterer ny strategi for kunstig intelligens i offentlig sektor",
    );
    const { sb } = makeSb([
      {
        path: /^\/media_articles\?published_at=gte/,
        reply: [
          {
            id: "match-1",
            wire_cluster_id: "cluster-existing",
            simhash_text: toPgBigint(theirs),
          },
        ],
      },
    ]);
    const r = await assignWireCluster(sb as any, {
      simhash: toPgBigint(ours),
      published_at: "2026-04-15T08:00:00Z",
    });
    expect(r).toBe("cluster-existing");
  });

  it("creates a new cluster when matched candidate has none", async () => {
    const ours = simhash(
      "Regjeringen lanserer ny strategi for kunstig intelligens i offentlig sektor",
    );
    const theirs = simhash(
      "Regjeringen presenterer ny strategi for kunstig intelligens i offentlig sektor",
    );
    let createdRepresentative: string | null = null;
    const { sb, calls } = makeSb([
      {
        path: /^\/media_articles\?published_at=gte/,
        method: "GET",
        reply: [
          {
            id: "match-1",
            wire_cluster_id: null,
            simhash_text: toPgBigint(theirs),
          },
        ],
      },
      {
        path: /^\/media_wire_clusters$/,
        method: "POST",
        reply: (_path: string, init: any) => {
          createdRepresentative = init.body.representative_article_id;
          return [{ id: "cluster-new" }];
        },
      },
      {
        path: /^\/media_articles\?id=eq\.match-1/,
        method: "PATCH",
        reply: null,
      },
    ]);

    const r = await assignWireCluster(sb as any, {
      simhash: toPgBigint(ours),
      published_at: "2026-04-15T08:00:00Z",
    });
    expect(r).toBe("cluster-new");
    expect(createdRepresentative).toBe("match-1");
    // Confirm we back-link the matched article to the new cluster.
    const patch = calls.find(
      (c) => /^\/media_articles\?id=eq\.match-1/.test(c.path) && c.init?.method === "PATCH",
    );
    expect(patch).toBeDefined();
    expect((patch?.init?.body as { wire_cluster_id: string }).wire_cluster_id).toBe(
      "cluster-new",
    );
  });

  it("returns null when best candidate is past the Hamming threshold", async () => {
    const ours = simhash(
      "Politiet etterforsker brann i bolighus i Bergen i natt etter naboklager",
    );
    const theirs = simhash(
      "OpenAI lanserer ny modell med betydelig bedre resonneringsevne for utviklere",
    );
    const { sb } = makeSb([
      {
        path: /^\/media_articles\?/,
        reply: [
          {
            id: "match-far",
            wire_cluster_id: "should-not-adopt",
            simhash_text: toPgBigint(theirs),
          },
        ],
      },
    ]);
    const r = await assignWireCluster(sb as any, {
      simhash: toPgBigint(ours),
      published_at: "2026-04-15T08:00:00Z",
    });
    expect(r).toBeNull();
  });

  it("survives a 64-bit signed simhash round-trip via the ::text cast", async () => {
    // A simhash whose top bit is set lands in the negative half of the int64
    // range. JSON-numbering it would lose precision; we read it back as text
    // and BigInt() restores exact bits.
    const big = -BigInt("0x7fffffffffffffff");
    const ours = simhash("anything");
    const { sb } = makeSb([
      {
        path: /^\/media_articles\?/,
        reply: [
          {
            id: "match-1",
            wire_cluster_id: "c-1",
            simhash_text: big.toString(),
          },
        ],
      },
    ]);
    // We don't expect a match (random hashes are far apart) but the bigint
    // parse must not throw.
    const r = await assignWireCluster(sb as any, {
      simhash: toPgBigint(ours),
      published_at: "2026-04-15T08:00:00Z",
    });
    // The hamming distance between random simhashes is ~32 bits — well above
    // threshold — so this is null. The point is we got there without
    // throwing on the BigInt parse.
    expect(r).toBeNull();
    // And fnv1a64 still works (sanity that the import is intact).
    expect(typeof fnv1a64("x")).toBe("bigint");
  });
});

// --- runFetchClassify integration: queue draining + insert wiring ---

describe("runFetchClassify", () => {
  it("returns noop when queue is empty", async () => {
    const { sb } = makeSb([{ path: /^\/media_url_queue\?/, reply: [] }]);
    const r: any = await (runFetchClassify as any)({ sb });
    expect(r.status).toBe("noop");
    expect(r.reason).toBe("queue_empty");
  });

  it("fetches one URL, inserts the article, marks queue 'fetched'", async () => {
    // Minimal page that the og-only branch can extract from.
    const html = `<!doctype html><html lang="no"><head>
      <meta property="og:title" content="Politikk og kunstig intelligens">
      <meta property="og:description" content="En kort tekst om temaet, kunstig intelligens i offentlig sektor.">
      <meta property="article:published_time" content="2026-04-15T08:00:00Z">
    </head><body></body></html>`;

    const fetcher = async (url: string) => {
      if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
      return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    };

    const { sb, calls } = makeSb([
      {
        path: /^\/media_url_queue\?status=eq\.pending/,
        method: "GET",
        reply: [
          {
            id: "q-1",
            url: "https://example.no/article-1",
            source_id: "src-1",
            attempts: 0,
            source: { id: "src-1", domain: "example.no", crawl_delay_ms: 100, extractor_config: null },
          },
        ],
      },
      { path: /^\/keywords\?/, reply: [{ term: "kunstig intelligens", language: "no", category: "concept", match_type: "substring" }] },
      { path: /^\/jobs$/, method: "POST", reply: [{ id: "job-1" }] },
      // Wire-cluster lookup — empty candidates
      {
        path: /^\/media_articles\?published_at=gte/,
        method: "GET",
        reply: [],
      },
      // Insert the article
      {
        path: /^\/media_articles$/,
        method: "POST",
        reply: [{ id: "article-1" }],
      },
      // Update queue row
      {
        path: /^\/media_url_queue\?id=eq\.q-1/,
        method: "PATCH",
        reply: null,
      },
      // Final job PATCH
      {
        path: /^\/jobs\?id=eq\.job-1/,
        method: "PATCH",
        reply: null,
      },
    ]);

    const r: any = await (runFetchClassify as any)({
      sb,
      fetcher,
      k: 1,
    });
    expect(r.status).toBe("success");
    expect(r.fetched).toBe(1);
    expect(r.inserted).toBe(1);
    expect(r.ai_count).toBe(1);

    // Queue row should be PATCHed to 'fetched'
    const queuePatch = calls.find(
      (c) => /^\/media_url_queue\?id=eq\.q-1/.test(c.path) && c.init?.method === "PATCH",
    );
    expect((queuePatch?.init?.body as { status: string }).status).toBe("fetched");

    // Article body should be a row with simhash + match_method='keyword'
    const insert = calls.find(
      (c) => c.path === "/media_articles" && c.init?.method === "POST",
    );
    const inserted = insert?.init?.body as Record<string, unknown>;
    expect(inserted.is_ai_related).toBe(true);
    expect(inserted.match_method).toBe("keyword");
    expect(inserted.url_hash).toMatch(/^[0-9a-f]{64}$/);
    // Body text NEVER persisted — confirm no body-shaped column on the row.
    expect(Object.keys(inserted)).not.toContain("body_text");
    expect(Object.keys(inserted)).not.toContain("body");
    expect(Object.keys(inserted)).not.toContain("content");
  });

  it("marks the queue row 'failed' on robots disallow", async () => {
    const fetcher = async (url: string) => {
      if (url.endsWith("/robots.txt")) {
        return new Response("User-agent: *\nDisallow: /\n", { status: 200 });
      }
      return new Response("", { status: 200 });
    };

    const { sb, calls } = makeSb([
      {
        path: /^\/media_url_queue\?status=eq\.pending/,
        method: "GET",
        reply: [
          {
            id: "q-2",
            url: "https://blocked.example.no/secret",
            source_id: "src-2",
            attempts: 0,
            source: { id: "src-2", domain: "blocked.example.no", crawl_delay_ms: 100 },
          },
        ],
      },
      { path: /^\/keywords\?/, reply: [] },
      { path: /^\/jobs$/, method: "POST", reply: [{ id: "job-2" }] },
      { path: /^\/media_url_queue\?id=eq\.q-2/, method: "PATCH", reply: null },
      { path: /^\/jobs\?id=eq\.job-2/, method: "PATCH", reply: null },
    ]);

    const r: any = await (runFetchClassify as any)({
      sb,
      fetcher,
      k: 1,
    });
    expect(r.status).toBe("success");
    expect(r.robots_blocked).toBe(1);
    expect(r.fetched).toBe(0);
    expect(r.inserted).toBe(0);

    const patch = calls.find(
      (c) => /^\/media_url_queue\?id=eq\.q-2/.test(c.path) && c.init?.method === "PATCH",
    );
    expect((patch?.init?.body as { status: string }).status).toBe("failed");
    expect((patch?.init?.body as { last_error: string }).last_error).toBe(
      "robots_disallow",
    );
  });
});
