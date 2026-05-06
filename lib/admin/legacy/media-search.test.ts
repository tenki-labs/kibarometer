import { describe, it, expect, beforeEach } from "vitest";
import {
  searchSourceUrls,
  extractArticleLinks,
  renderTemplate,
} from "./media-search.js";
import { _resetRateLimitForTests } from "./media-client.js";
import { _resetCache } from "./media-robots.js";

beforeEach(() => {
  _resetRateLimitForTests();
  _resetCache();
});

describe("renderTemplate", () => {
  it("substitutes named placeholders", () => {
    expect(
      renderTemplate("https://x.no/?q={q}&page={page}", { q: "AI", page: 2 }),
    ).toBe("https://x.no/?q=AI&page=2");
  });

  it("URL-encodes Norwegian characters", () => {
    expect(
      renderTemplate("https://x.no/?q={q}", { q: "kunstig intelligens" }),
    ).toBe("https://x.no/?q=kunstig%20intelligens");
  });

  it("renders missing keys as empty", () => {
    expect(renderTemplate("https://x.no/?q={q}&t={to}", { q: "AI" })).toBe(
      "https://x.no/?q=AI&t=",
    );
  });
});

describe("extractArticleLinks", () => {
  const PAGE = `<!doctype html><html><body>
    <article>
      <a href="/artikkel/kunstig-intelligens-1">A1</a>
      <a href="https://www.digi.no/artikkel/openai-2">A2</a>
      <a href="//www.digi.no/artikkel/protocol-relative-3">A3</a>
    </article>
    <nav>
      <a href="/sok?q=AI&page=2">side 2</a>
      <a href="/kategori/ki">kategori</a>
      <a href="/feed.xml">feed</a>
      <a href="/abonnement">abonnement</a>
    </nav>
    <a href="/static/logo.svg">logo</a>
    <a href="https://example.com/external">external</a>
    <a href="javascript:void(0)">js</a>
    <a href="#hash-only">hash</a>
    <a href="/artikkel/regjeringen-lanserer-strategi-4?utm=foo#section">A4</a>
  </body></html>`;

  it("returns absolute URLs scoped to the source domain", () => {
    const out = extractArticleLinks(PAGE, "digi.no");
    expect(out).toContain("https://digi.no/artikkel/kunstig-intelligens-1");
    expect(out).toContain("https://www.digi.no/artikkel/openai-2");
  });

  it("strips utm and fragments", () => {
    const out = extractArticleLinks(PAGE, "digi.no");
    expect(out).toContain(
      "https://digi.no/artikkel/regjeringen-lanserer-strategi-4",
    );
    expect(out.some((u) => u.includes("utm"))).toBe(false);
    expect(out.some((u) => u.includes("#"))).toBe(false);
  });

  it("rejects pagination, category, feed, and asset URLs", () => {
    const out = extractArticleLinks(PAGE, "digi.no");
    expect(out.some((u) => u.includes("/sok"))).toBe(false);
    expect(out.some((u) => u.includes("/kategori"))).toBe(false);
    expect(out.some((u) => u.includes("/feed"))).toBe(false);
    expect(out.some((u) => u.includes(".svg"))).toBe(false);
  });

  it("rejects external domains", () => {
    const out = extractArticleLinks(PAGE, "digi.no");
    expect(out.some((u) => u.includes("example.com"))).toBe(false);
  });

  it("dedupes the protocol-relative variant against the absolute one", () => {
    const out = extractArticleLinks(PAGE, "digi.no");
    // Both `https://www.digi.no/artikkel/openai-2` and the `//www.digi.no/`
    // variant resolve to the same canonical URL.
    expect(
      out.filter((u) => u.endsWith("/artikkel/openai-2")).length,
    ).toBe(1);
  });

  it("returns empty for empty/garbage input", () => {
    expect(extractArticleLinks("", "digi.no")).toEqual([]);
    expect(extractArticleLinks("<not html>", "digi.no")).toEqual([]);
  });

  it("matches subdomains of the source domain", () => {
    const html = `<a href="https://nyheter.example.no/article">x</a>`;
    expect(extractArticleLinks(html, "example.no")).toEqual([
      "https://nyheter.example.no/article",
    ]);
  });
});

describe("searchSourceUrls — orchestrator", () => {
  function makeFetcher(pages: Record<string, string>) {
    return async (url: string) => {
      if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
      const body = pages[url];
      if (body == null) return new Response("", { status: 404 });
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    };
  }

  it("iterates queries × pages and dedupes URLs across them", async () => {
    const fetcher = makeFetcher({
      "https://digi.no/sok?q=AI&page=1":
        '<a href="/artikkel/openai-1">x</a><a href="/artikkel/shared">y</a>',
      "https://digi.no/sok?q=AI&page=2": "<a></a>",
      "https://digi.no/sok?q=KI&page=1":
        '<a href="/artikkel/ki-1">x</a><a href="/artikkel/shared">y</a>',
    });
    const { urls, stats } = await searchSourceUrls({
      source: {
        id: "s",
        domain: "digi.no",
        crawl_delay_ms: 100,
        search_config: {
          url_template: "https://digi.no/sok?q={q}&page={page}",
          max_pages_per_query: 5,
        },
      },
      queries: ["AI", "KI"],
      fetcher,
    });
    expect(urls).toContain("https://digi.no/artikkel/openai-1");
    expect(urls).toContain("https://digi.no/artikkel/ki-1");
    expect(urls.filter((u) => u.endsWith("/artikkel/shared")).length).toBe(1);
    expect(stats.queries).toBe(2);
    expect(stats.pages_fetched).toBeGreaterThanOrEqual(2);
  });

  it("stops walking a query when a page returns no new URLs", async () => {
    const fetcher = makeFetcher({
      "https://digi.no/sok?q=AI&page=1": '<a href="/artikkel/a-1">x</a>',
      "https://digi.no/sok?q=AI&page=2": "<html><body></body></html>",
      "https://digi.no/sok?q=AI&page=3":
        '<a href="/artikkel/should-not-reach">x</a>',
    });
    const { urls } = await searchSourceUrls({
      source: {
        id: "s",
        domain: "digi.no",
        crawl_delay_ms: 100,
        search_config: {
          url_template: "https://digi.no/sok?q={q}&page={page}",
          max_pages_per_query: 10,
        },
      },
      queries: ["AI"],
      fetcher,
    });
    expect(urls).toContain("https://digi.no/artikkel/a-1");
    expect(urls.some((u) => u.includes("should-not-reach"))).toBe(false);
  });

  it("throws when search_config is missing", async () => {
    await expect(
      searchSourceUrls({
        source: { id: "s", domain: "digi.no", search_config: null },
        queries: ["AI"],
      }),
    ).rejects.toThrow(/search_config/);
  });

  it("throws when queries arg is empty", async () => {
    await expect(
      searchSourceUrls({
        source: {
          id: "s",
          domain: "digi.no",
          search_config: {
            url_template: "https://digi.no/sok?q={q}",
          },
        },
        queries: [],
      }),
    ).rejects.toThrow(/queries/);
  });

  it("survives a single failed page and continues to the next query", async () => {
    const fetcher = async (url: string) => {
      if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
      if (url.includes("q=AI")) return new Response("", { status: 503 });
      if (url.includes("q=KI")) {
        return new Response('<a href="/artikkel/ok">x</a>', { status: 200 });
      }
      return new Response("", { status: 404 });
    };
    const { urls, stats } = await searchSourceUrls({
      source: {
        id: "s",
        domain: "digi.no",
        crawl_delay_ms: 100,
        search_config: {
          url_template: "https://digi.no/sok?q={q}&page={page}",
          max_pages_per_query: 2,
        },
      },
      queries: ["AI", "KI"],
      fetcher,
    });
    expect(urls).toEqual(["https://digi.no/artikkel/ok"]);
    expect(stats.pages_failed).toBeGreaterThan(0);
  });

  it("respects the wall-time budget", async () => {
    let calls = 0;
    let nowMs = 0;
    const fetcher = async (url: string) => {
      if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
      calls += 1;
      nowMs += 50; // each fetch advances mock clock
      return new Response('<a href="/artikkel/x-' + calls + '">x</a>', {
        status: 200,
      });
    };
    const { stats } = await searchSourceUrls({
      source: {
        id: "s",
        domain: "digi.no",
        crawl_delay_ms: 100,
        search_config: {
          url_template: "https://digi.no/sok?q={q}&page={page}",
          max_pages_per_query: 50,
        },
      },
      queries: ["AI"],
      fetcher,
      maxWallMs: 100, // 100 ms cap; 50 ms per page → ~2 pages
      now: () => nowMs,
    });
    expect(stats.stopped).toBe("wall_time");
  });
});
