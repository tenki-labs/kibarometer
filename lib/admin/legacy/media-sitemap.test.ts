import { describe, it, expect, beforeEach } from "vitest";
import { walkSitemap, parseSitemap } from "./media-sitemap.js";
import { _resetRateLimitForTests } from "./media-client.js";
import { _resetCache } from "./media-robots.js";

beforeEach(() => {
  _resetRateLimitForTests();
  _resetCache();
});

const FLAT = `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://www.example.no/artikkel/a-1</loc>
    <lastmod>2026-04-01</lastmod>
  </url>
  <url>
    <loc><![CDATA[https://www.example.no/artikkel/a-2]]></loc>
  </url>
  <url>
    <loc>https://www.example.no/artikkel/a-3</loc>
  </url>
</urlset>`;

const INDEX = `<?xml version="1.0"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>https://www.example.no/sitemap-2026-04.xml</loc>
    <lastmod>2026-04-30</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://www.example.no/sitemap-2026-03.xml</loc>
    <lastmod>2026-03-31</lastmod>
  </sitemap>
</sitemapindex>`;

const APR = `<?xml version="1.0"?>
<urlset>
  <url><loc>https://www.example.no/artikkel/april-1</loc></url>
  <url><loc>https://www.example.no/artikkel/april-2</loc></url>
</urlset>`;

const MAR = `<?xml version="1.0"?>
<urlset>
  <url><loc>https://www.example.no/artikkel/march-1</loc></url>
</urlset>`;

// Dated entries used by the since-filter tests below.
const DATED = `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://www.example.no/old-2018</loc><lastmod>2018-06-15</lastmod></url>
  <url><loc>https://www.example.no/edge-2020</loc><lastmod>2020-01-01</lastmod></url>
  <url><loc>https://www.example.no/recent-2024</loc><lastmod>2024-08-12</lastmod></url>
  <url><loc>https://www.example.no/no-date</loc></url>
</urlset>`;

const HISTORICAL_INDEX = `<?xml version="1.0"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://www.example.no/sm-2018-q1.xml</loc><lastmod>2018-03-31</lastmod></sitemap>
  <sitemap><loc>https://www.example.no/sm-2024-q2.xml</loc><lastmod>2024-06-30</lastmod></sitemap>
  <sitemap><loc>https://www.example.no/sm-no-date.xml</loc></sitemap>
</sitemapindex>`;

describe("parseSitemap", () => {
  it("extracts <url> entries with loc + lastmod from a flat urlset", () => {
    const { childSitemaps, urls } = parseSitemap(FLAT);
    expect(childSitemaps).toEqual([]);
    expect(urls.map((u) => u.loc)).toEqual([
      "https://www.example.no/artikkel/a-1",
      "https://www.example.no/artikkel/a-2",
      "https://www.example.no/artikkel/a-3",
    ]);
    // Only the first entry has a <lastmod>.
    expect(urls[0].lastmod).toBe(Date.parse("2026-04-01"));
    expect(urls[1].lastmod).toBeNull();
    expect(urls[2].lastmod).toBeNull();
  });

  it("extracts <sitemap> children with loc + lastmod", () => {
    const { childSitemaps, urls } = parseSitemap(INDEX);
    expect(urls).toEqual([]);
    expect(childSitemaps.map((s) => s.loc)).toEqual([
      "https://www.example.no/sitemap-2026-04.xml",
      "https://www.example.no/sitemap-2026-03.xml",
    ]);
    expect(childSitemaps[0].lastmod).toBe(Date.parse("2026-04-30"));
    expect(childSitemaps[1].lastmod).toBe(Date.parse("2026-03-31"));
  });

  it("returns empty arrays for empty/garbage input", () => {
    expect(parseSitemap("")).toEqual({ childSitemaps: [], urls: [] });
    expect(parseSitemap(null as never)).toEqual({
      childSitemaps: [],
      urls: [],
    });
  });

  it("handles CDATA-wrapped <loc>", () => {
    const xml = `<urlset><url><loc><![CDATA[https://x.no/y]]></loc></url></urlset>`;
    const { urls } = parseSitemap(xml);
    expect(urls.map((u) => u.loc)).toEqual(["https://x.no/y"]);
  });
});

describe("walkSitemap", () => {
  function makeFetcher(map: Record<string, string>) {
    return async (url: string) => {
      if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
      const body = map[url];
      if (body == null) return new Response("", { status: 404 });
      return new Response(body, {
        status: 200,
        headers: { "content-type": "application/xml" },
      });
    };
  }

  it("returns the flat urlset when sitemap_index=false", async () => {
    const fetcher = makeFetcher({
      "https://www.example.no/sitemap.xml": FLAT,
    });
    const { urls, stats } = await walkSitemap({
      source: {
        id: "s",
        domain: "example.no",
        sitemap_url: "https://www.example.no/sitemap.xml",
        sitemap_index: false,
        crawl_delay_ms: 100,
      },
      fetcher,
    });
    expect(urls).toHaveLength(3);
    expect(urls).toContain("https://www.example.no/artikkel/a-1");
    expect(stats.fetched).toBe(1);
  });

  it("walks a sitemap index and returns merged URLs", async () => {
    const fetcher = makeFetcher({
      "https://www.example.no/sitemap.xml": INDEX,
      "https://www.example.no/sitemap-2026-04.xml": APR,
      "https://www.example.no/sitemap-2026-03.xml": MAR,
    });
    const { urls, stats } = await walkSitemap({
      source: {
        id: "s",
        domain: "example.no",
        sitemap_url: "https://www.example.no/sitemap.xml",
        sitemap_index: true,
        crawl_delay_ms: 100,
      },
      fetcher,
    });
    expect(urls).toHaveLength(3);
    expect(urls).toEqual(
      expect.arrayContaining([
        "https://www.example.no/artikkel/april-1",
        "https://www.example.no/artikkel/april-2",
        "https://www.example.no/artikkel/march-1",
      ]),
    );
    expect(stats.fetched).toBe(3);
  });

  it("respects the limit", async () => {
    const fetcher = makeFetcher({
      "https://www.example.no/sitemap.xml": FLAT,
    });
    const { urls } = await walkSitemap({
      source: {
        id: "s",
        domain: "example.no",
        sitemap_url: "https://www.example.no/sitemap.xml",
        sitemap_index: false,
        crawl_delay_ms: 100,
      },
      fetcher,
      limit: 2,
    });
    expect(urls).toHaveLength(2);
  });

  it("counts failed fetches without throwing", async () => {
    const fetcher = async (url: string) => {
      if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
      return new Response("", { status: 503 });
    };
    const { urls, stats } = await walkSitemap({
      source: {
        id: "s",
        domain: "example.no",
        sitemap_url: "https://www.example.no/sitemap.xml",
        sitemap_index: false,
        crawl_delay_ms: 100,
      },
      fetcher,
    });
    expect(urls).toEqual([]);
    expect(stats.failed).toBe(1);
  });

  it("throws when sitemap_url is missing", async () => {
    await expect(
      walkSitemap({
        source: {
          id: "s",
          domain: "example.no",
          sitemap_url: null,
          crawl_delay_ms: 100,
        },
      }),
    ).rejects.toThrow(/sitemap_url/);
  });

  it("filters <url> entries by lastmod when `since` is set", async () => {
    const fetcher = makeFetcher({
      "https://www.example.no/sitemap.xml": DATED,
    });
    const { urls, stats } = await walkSitemap({
      source: {
        id: "s",
        domain: "example.no",
        sitemap_url: "https://www.example.no/sitemap.xml",
        sitemap_index: false,
        crawl_delay_ms: 100,
      },
      fetcher,
      since: "2020-01-01",
    });
    // 2018 dropped; 2020-01-01 (== since) kept; 2024 kept; no-date kept
    // (we can't tell so we include — downstream filters handle it).
    expect(urls).toEqual(
      expect.arrayContaining([
        "https://www.example.no/edge-2020",
        "https://www.example.no/recent-2024",
        "https://www.example.no/no-date",
      ]),
    );
    expect(urls).not.toContain("https://www.example.no/old-2018");
    expect(stats.urls_filtered_by_date).toBe(1);
  });

  it("skips sub-sitemaps whose lastmod is older than `since`", async () => {
    const fetcher = makeFetcher({
      "https://www.example.no/sitemap.xml": HISTORICAL_INDEX,
      "https://www.example.no/sm-2024-q2.xml": APR,
      "https://www.example.no/sm-no-date.xml": MAR,
      // sm-2018-q1.xml intentionally missing — if we erroneously
      // descend into it, fetcher would 404 and stats.failed would tick.
    });
    const { urls, stats } = await walkSitemap({
      source: {
        id: "s",
        domain: "example.no",
        sitemap_url: "https://www.example.no/sitemap.xml",
        sitemap_index: true,
        crawl_delay_ms: 100,
      },
      fetcher,
      since: "2020-01-01",
    });
    // Should descend into 2024-q2 and the undated sitemap, skip 2018-q1.
    expect(urls).toEqual(
      expect.arrayContaining([
        "https://www.example.no/artikkel/april-1",
        "https://www.example.no/artikkel/march-1",
      ]),
    );
    expect(stats.subsitemaps_skipped_by_lastmod).toBe(1);
    expect(stats.failed).toBe(0); // proves we didn't try to fetch 2018-q1
  });

  it("throws on a malformed `since` value", async () => {
    await expect(
      walkSitemap({
        source: {
          id: "s",
          domain: "example.no",
          sitemap_url: "https://www.example.no/sitemap.xml",
          crawl_delay_ms: 100,
        },
        since: "not-a-date",
      }),
    ).rejects.toThrow(/ugyldig since/);
  });
});
