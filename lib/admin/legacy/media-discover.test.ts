import { describe, it, expect } from "vitest";
import { parseRssFeed, runDiscover } from "./media-discover.js";
import { compileMatchers } from "./media-processor.js";

const RSS_2_0 = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Digi.no</title>
    <link>https://www.digi.no</link>
    <item>
      <title>Regjeringen lanserer ny KI-strategi</title>
      <link>https://www.digi.no/artikler/regjeringen-lanserer-ny-ki-strategi/123</link>
      <description><![CDATA[<p>Statsråden vil at norske kommuner skal ta i bruk kunstig intelligens.</p>]]></description>
      <pubDate>Wed, 15 Apr 2026 08:00:00 +0200</pubDate>
      <guid>https://www.digi.no/artikler/regjeringen-lanserer-ny-ki-strategi/123</guid>
    </item>
    <item>
      <title>Brann i bolighus i Bergen</title>
      <link>https://www.digi.no/artikler/brann-bergen/456</link>
      <description>Politiet etterforsker omstendighetene.</description>
      <pubDate>Wed, 15 Apr 2026 09:00:00 +0200</pubDate>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Kode24</title>
  <entry>
    <title>OpenAI lanserer ny modell</title>
    <link href="https://www.kode24.no/artikkel/openai-modell/789" rel="alternate"/>
    <summary>Selskapet sier ChatGPT får bedre resonneringsevne.</summary>
    <published>2026-04-15T10:00:00Z</published>
    <id>tag:kode24.no,2026:789</id>
  </entry>
  <entry>
    <title>Helt vanlig fotball-nyhet</title>
    <link href="https://www.kode24.no/sport/foo/111"/>
    <summary>Ingenting interessant her.</summary>
  </entry>
</feed>`;

describe("parseRssFeed — RSS 2.0", () => {
  it("extracts title, link, description, pubDate from each item", () => {
    const items = parseRssFeed(RSS_2_0);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("Regjeringen lanserer ny KI-strategi");
    expect(items[0].link).toBe(
      "https://www.digi.no/artikler/regjeringen-lanserer-ny-ki-strategi/123",
    );
    expect(items[0].description).toContain("kunstig intelligens");
    expect(items[0].pubDate).toMatch(/2026/);
  });

  it("strips inner tags from CDATA descriptions", () => {
    const items = parseRssFeed(RSS_2_0);
    expect(items[0].description).not.toContain("<p>");
  });
});

describe("parseRssFeed — Atom", () => {
  it("extracts href off <link> for entries", () => {
    const items = parseRssFeed(ATOM);
    expect(items).toHaveLength(2);
    expect(items[0].link).toBe(
      "https://www.kode24.no/artikkel/openai-modell/789",
    );
    expect(items[0].description).toContain("ChatGPT");
    expect(items[0].pubDate).toMatch(/2026-04-15/);
  });
});

describe("parseRssFeed — robustness", () => {
  it("returns [] for empty / non-string input", () => {
    expect(parseRssFeed("")).toEqual([]);
    expect(parseRssFeed(null as never)).toEqual([]);
    expect(parseRssFeed(undefined as never)).toEqual([]);
  });

  it("ignores items without a link", () => {
    const xml = `<rss><channel>
      <item><title>No link</title></item>
      <item><title>Has link</title><link>https://example.no/a</link></item>
    </channel></rss>`;
    const items = parseRssFeed(xml);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Has link");
  });

  it("dedupes items that appear in both <item> and <entry> shapes", () => {
    const xml = `<feed>
      <entry><title>Dup</title><link href="https://example.no/dup"/></entry>
      <item><title>Dup</title><link>https://example.no/dup</link></item>
    </feed>`;
    const items = parseRssFeed(xml);
    expect(items).toHaveLength(1);
  });

  it("decodes HTML entities in titles and descriptions", () => {
    const xml = `<rss><channel>
      <item>
        <title>Tom &amp; Jerry &mdash; AI</title>
        <link>https://example.no/x</link>
        <description>&quot;quoted&quot;</description>
      </item>
    </channel></rss>`;
    const items = parseRssFeed(xml);
    expect(items[0].title).toBe("Tom & Jerry — AI");
    expect(items[0].description).toBe('"quoted"');
  });
});

// --- Orchestrator integration test (fully stubbed sb + fetcher) ---

type SbCall = { path: string; init?: { method?: string; body?: unknown } };

function makeSb(rows: { path: RegExp; reply: unknown }[]) {
  const calls: SbCall[] = [];
  const sb = async (path: string, init: any = {}) => {
    calls.push({ path, init });
    for (const r of rows) {
      if (r.path.test(path)) return r.reply;
    }
    return [];
  };
  return { sb, calls };
}

describe("runDiscover", () => {
  const matchers = compileMatchers([
    { term: "kunstig intelligens", match_type: "substring" },
    { term: "ChatGPT", match_type: "word" },
  ]);
  // Sanity: matchers compile without throwing.
  expect(matchers.length).toBe(2);

  it("polls active sources, filters items, and enqueues only matches", async () => {
    const { sb, calls } = makeSb([
      // /media_sources?is_active=eq.true&rss_url=not.is.null...
      {
        path: /^\/media_sources\?is_active=eq\.true/,
        reply: [
          {
            id: "11111111-1111-1111-1111-111111111111",
            name: "Digi.no",
            domain: "digi.no",
            rss_url: "https://www.digi.no/rss",
            crawl_delay_ms: 1500,
          },
        ],
      },
      // /keywords?status=in.(canonical,trial)&domain=in.(media,any)
      {
        path: /^\/keywords\?/,
        reply: [
          { term: "kunstig intelligens", language: "no", category: "concept", match_type: "substring" },
        ],
      },
      // POST /jobs (return=representation) → returns the inserted row
      { path: /^\/jobs$/, reply: [{ id: "job-1" }] },
      // POST /media_url_queue → returns inserted rows
      { path: /^\/media_url_queue$/, reply: [{ id: "q-1" }] },
    ]);

    const fetcher = async (url: string) => {
      if (url.endsWith("/robots.txt")) {
        return new Response("", { status: 404 });
      }
      return new Response(RSS_2_0, {
        status: 200,
        headers: { "content-type": "application/rss+xml" },
      });
    };

    const r: any = await (runDiscover as any)({
      sb,
      fetcher,
      trigger: "cron",
    });
    expect(r.status).toBe("success");
    expect(r.items_seen).toBe(2); // both items in the RSS feed
    expect(r.items_matched).toBe(1); // only the KI-strategi one matches
    expect(r.enqueued).toBe(1);

    // The body sent to /media_url_queue should contain exactly the matching URL
    const queueInsert = calls.find(
      (c) => c.path === "/media_url_queue" && c.init?.method === "POST",
    );
    expect(queueInsert).toBeDefined();
    const body = (queueInsert?.init?.body as Array<{ url: string }>) || [];
    expect(body).toHaveLength(1);
    expect(body[0].url).toContain("regjeringen-lanserer-ny-ki-strategi");
  });

  it("returns noop when no active sources have rss_url", async () => {
    const { sb } = makeSb([
      { path: /^\/media_sources\?/, reply: [] },
      { path: /^\/jobs$/, reply: [{ id: "job-1" }] },
    ]);
    const r: any = await (runDiscover as any)({ sb, trigger: "cron" });
    expect(r.status).toBe("noop");
    expect(r.reason).toBe("no_active_rss_sources");
  });

  it("records source error but doesn't throw on robots disallow", async () => {
    const { sb } = makeSb([
      {
        path: /^\/media_sources\?is_active=eq\.true/,
        reply: [
          {
            id: "11111111-1111-1111-1111-111111111111",
            name: "Blocked",
            domain: "blocked.example.no",
            rss_url: "https://blocked.example.no/feed",
            crawl_delay_ms: 1000,
          },
        ],
      },
      { path: /^\/keywords\?/, reply: [] },
      { path: /^\/jobs$/, reply: [{ id: "job-1" }] },
    ]);

    const fetcher = async (url: string) => {
      if (url.endsWith("/robots.txt")) {
        return new Response("User-agent: *\nDisallow: /\n", { status: 200 });
      }
      throw new Error("should not reach");
    };

    const r: any = await (runDiscover as any)({
      sb,
      fetcher,
      trigger: "cron",
    });
    expect(r.status).toBe("success");
    expect(r.enqueued).toBe(0);
    expect(r.errors[0]?.error).toBe("robots_disallow");
  });

  it("bails between sources when maxWallMs is exceeded", async () => {
    const { sb } = makeSb([
      {
        path: /^\/media_sources\?is_active=eq\.true/,
        reply: [
          {
            id: "11111111-1111-1111-1111-111111111111",
            name: "First",
            domain: "first.example.no",
            rss_url: "https://first.example.no/rss",
            crawl_delay_ms: 0,
          },
          {
            id: "22222222-2222-2222-2222-222222222222",
            name: "Second",
            domain: "second.example.no",
            rss_url: "https://second.example.no/rss",
            crawl_delay_ms: 0,
          },
        ],
      },
      { path: /^\/keywords\?/, reply: [] },
      { path: /^\/jobs$/, reply: [{ id: "job-1" }] },
      { path: /^\/media_url_queue$/, reply: [] },
    ]);

    // Fetcher records every URL it sees so we can prove the second source
    // was never asked for. The first source returns an empty feed so it
    // completes quickly; the wall-time check happens at the top of the
    // next iteration.
    const seen: string[] = [];
    const fetcher = async (url: string) => {
      seen.push(url);
      if (url.endsWith("/robots.txt")) {
        return new Response("", { status: 404 });
      }
      return new Response("<rss><channel></channel></rss>", {
        status: 200,
        headers: { "content-type": "application/rss+xml" },
      });
    };

    // The orchestrator calls now() at startMs (returns 0), then again at
    // the top of each loop iteration. Pinning the second reading at 10
    // (still < maxWallMs=50) lets the first source through; the third
    // reading jumps to 100 so the second iteration check trips and the
    // second source is never fetched.
    const ts = [0, 10, 100];
    let i = 0;
    const now = () => ts[Math.min(i++, ts.length - 1)];

    const r: any = await (runDiscover as any)({
      sb,
      fetcher,
      now,
      maxWallMs: 50,
      trigger: "manual",
    });

    expect(r.status).toBe("success");
    // Only the first source was contacted (robots.txt + rss). The second
    // source's domain must never appear in the recorded fetches.
    expect(seen.some((u) => u.startsWith("https://first.example.no/"))).toBe(
      true,
    );
    expect(seen.some((u) => u.startsWith("https://second.example.no/"))).toBe(
      false,
    );
  });
});
