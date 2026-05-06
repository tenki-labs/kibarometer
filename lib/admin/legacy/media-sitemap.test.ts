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
  </sitemap>
  <sitemap>
    <loc>https://www.example.no/sitemap-2026-03.xml</loc>
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

describe("parseSitemap", () => {
  it("extracts <url><loc> entries from a flat urlset", () => {
    const { childSitemaps, locs } = parseSitemap(FLAT);
    expect(childSitemaps).toEqual([]);
    expect(locs).toEqual([
      "https://www.example.no/artikkel/a-1",
      "https://www.example.no/artikkel/a-2",
      "https://www.example.no/artikkel/a-3",
    ]);
  });

  it("extracts <sitemap><loc> children from a sitemap index", () => {
    const { childSitemaps, locs } = parseSitemap(INDEX);
    expect(locs).toEqual([]);
    expect(childSitemaps).toEqual([
      "https://www.example.no/sitemap-2026-04.xml",
      "https://www.example.no/sitemap-2026-03.xml",
    ]);
  });

  it("returns empty arrays for empty/garbage input", () => {
    expect(parseSitemap("")).toEqual({ childSitemaps: [], locs: [] });
    expect(parseSitemap(null as never)).toEqual({
      childSitemaps: [],
      locs: [],
    });
  });

  it("handles CDATA-wrapped <loc>", () => {
    const xml = `<urlset><url><loc><![CDATA[https://x.no/y]]></loc></url></urlset>`;
    expect(parseSitemap(xml).locs).toEqual(["https://x.no/y"]);
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
});
