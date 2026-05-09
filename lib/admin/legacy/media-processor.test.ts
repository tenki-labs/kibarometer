import { describe, it, expect } from "vitest";
import { canonicalizeUrl, urlHash, buildHaystack, buildArticleRow, rssItemMatchesKeywords, compileMatchers } from "./media-processor.js";

describe("canonicalizeUrl", () => {
  it("strips fragment and lowercases host", () => {
    expect(canonicalizeUrl("HTTPS://Digi.NO/articles/foo#section-2"))
      .toBe("https://digi.no/articles/foo");
  });

  it("removes utm_* and other tracking params", () => {
    const result = canonicalizeUrl("https://nrk.no/x?utm_source=twitter&utm_campaign=ai&id=42");
    expect(result).toBe("https://nrk.no/x?id=42");
  });

  it("preserves non-tracking query parameters in sorted order", () => {
    expect(canonicalizeUrl("https://kode24.no/article?b=2&a=1"))
      .toBe("https://kode24.no/article?a=1&b=2");
  });

  it("strips trailing slash from non-root paths only", () => {
    expect(canonicalizeUrl("https://example.no/article/")).toBe("https://example.no/article");
    expect(canonicalizeUrl("https://example.no/")).toBe("https://example.no/");
  });

  it("rejects non-http(s) and malformed URLs", () => {
    expect(canonicalizeUrl("ftp://example.no/x")).toBeNull();
    expect(canonicalizeUrl("not a url")).toBeNull();
    expect(canonicalizeUrl("")).toBeNull();
  });
});

describe("urlHash", () => {
  it("returns 64-hex sha256", () => {
    const h = urlHash("https://example.no/x");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("treats canonically-equivalent URLs as identical", () => {
    expect(urlHash("https://NRK.no/x?utm_source=fb#frag"))
      .toBe(urlHash("https://nrk.no/x"));
  });

  it("differs across distinct canonicals", () => {
    expect(urlHash("https://nrk.no/a")).not.toBe(urlHash("https://nrk.no/b"));
  });
});

describe("buildHaystack", () => {
  it("includes headline + lede always", () => {
    const h = buildHaystack({
      headline: "AI in Norway",
      lede: "An overview",
      body_text: "ignored",
      extraction_quality: "metadata-only",
    });
    expect(h).toContain("AI in Norway");
    expect(h).toContain("An overview");
    expect(h).not.toContain("ignored");
  });

  it("adds a body slice on full/partial quality", () => {
    const body = "x".repeat(800);
    const h = buildHaystack({
      headline: "T",
      lede: "L",
      body_text: body,
      extraction_quality: "full",
    });
    expect(h.length).toBeGreaterThan(500);
    expect(h.length).toBeLessThan(800); // capped at 500 chars from body
  });
});

describe("buildArticleRow", () => {
  const matchers = compileMatchers([
    { term: "kunstig intelligens", match_type: "substring" },
    { term: "AI", match_type: "word" },
  ]);

  it("produces a valid insert row with simhash and tags", () => {
    const extracted = {
      headline: "Regjeringen vil ha mer kunstig intelligens",
      byline: "Ola Nordmann",
      published_at: "2026-04-15T08:00:00Z",
      last_modified_at: null,
      language: "no",
      lede: "Statsråden vil at norske kommuner skal bruke AI.",
      body_text: "Body text".repeat(100),
      word_count: 200,
      og_image_url: "https://example.no/img.jpg",
      amp_url: null,
      extraction_strategy_used: "jsonld",
      extraction_quality: "full",
    };
    const row = buildArticleRow({
      url: "https://digi.no/article/123?utm_source=newsletter",
      sourceId: "11111111-1111-1111-1111-111111111111",
      extracted,
      matchers,
      discoveredAt: "2026-04-15T09:00:00Z",
      ingestMode: "live",
    });

    expect(row.url).toBe("https://digi.no/article/123");
    expect(row.url_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.is_ai_related).toBe(true);
    expect(row.matched_keywords).toEqual(expect.arrayContaining(["kunstig intelligens", "AI"]));
    expect(row.match_method).toBe("keyword");
    expect(row.simhash).toMatch(/^-?\d+$/);          // decimal string for PG bigint
    expect(row.extraction_quality).toBe("full");
    expect(row.extraction_strategy_used).toBe("jsonld");
    expect(row.tier1_completed_at).toBeNull();
    expect(row.tier2_completed_at).toBeNull();
    expect(row.wire_cluster_id).toBeNull();
    expect(row.last_seen_at).toBe("2026-04-15T09:00:00Z");
    expect(row.published_at).toBe("2026-04-15T08:00:00Z");
    expect(row.ingest_mode).toBe("live");
  });

  it("sets is_ai_related=false and match_method=null when nothing matches", () => {
    const extracted = {
      headline: "Brann i bolighus i Bergen",
      byline: null,
      published_at: null,
      last_modified_at: null,
      language: "no",
      lede: "Politiet etterforsker.",
      body_text: null,
      word_count: 0,
      og_image_url: null,
      amp_url: null,
      extraction_strategy_used: "og-only",
      extraction_quality: "metadata-only",
    };
    const row = buildArticleRow({
      url: "https://nrk.no/brann-bergen",
      sourceId: "22222222-2222-2222-2222-222222222222",
      extracted,
      matchers,
      ingestMode: "live",
    });
    expect(row.is_ai_related).toBe(false);
    expect(row.matched_keywords).toEqual([]);
    expect(row.match_method).toBeNull();
  });

  it("defaults language to 'no' when extraction returns null", () => {
    const extracted = {
      headline: "X", byline: null, published_at: null, last_modified_at: null,
      language: null, lede: null, body_text: null, word_count: 0,
      og_image_url: null, amp_url: null,
      extraction_strategy_used: "og-only", extraction_quality: "metadata-only",
    };
    const row = buildArticleRow({
      url: "https://example.no/x",
      sourceId: "33333333-3333-3333-3333-333333333333",
      extracted,
      matchers,
      ingestMode: "live",
    });
    expect(row.language).toBe("no");
  });
});

describe("rssItemMatchesKeywords", () => {
  const matchers = compileMatchers([
    { term: "kunstig intelligens", match_type: "substring" },
  ]);

  it("matches on title alone", () => {
    const r = rssItemMatchesKeywords(
      { title: "Ny strategi for kunstig intelligens", description: "" },
      matchers,
    );
    expect(r.is_ai).toBe(true);
  });

  it("matches on description alone", () => {
    const r = rssItemMatchesKeywords(
      { title: "Politikk", description: "Regjeringen og kunstig intelligens i kommunene" },
      matchers,
    );
    expect(r.is_ai).toBe(true);
  });

  it("returns false when neither matches", () => {
    const r = rssItemMatchesKeywords(
      { title: "Brann i bolighus", description: "Bergen" },
      matchers,
    );
    expect(r.is_ai).toBe(false);
  });
});
