import { describe, it, expect } from "vitest";
import { extractArticle, decodeEntities } from "./media-extract.js";

const FULL_BODY = `Regjeringen presenterer i dag en ny nasjonal strategi for kunstig intelligens i offentlig sektor. Statsråden uttaler at målet er at norske kommuner skal kunne ta i bruk språkmodeller for å effektivisere saksbehandling og kommunikasjon med innbyggere. Strategien inkluderer 500 millioner kroner i øremerkede midler over en treårsperiode samt en ny samordningsenhet under Digitaliseringsdirektoratet. ${"Mer tekst om kunstig intelligens og maskinlæring som fyller ut artikkelen til full kvalitet. ".repeat(20)}`;

function jsonLdPage({ headline, body, datePublished, dateModified, author, lang, image }: any) {
  const ld = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline,
    articleBody: body,
    datePublished,
    dateModified,
    author: author ? { "@type": "Person", name: author } : undefined,
    inLanguage: lang,
    image: image ? { "@type": "ImageObject", url: image } : undefined,
  };
  return `<!doctype html><html lang="${lang || "no"}"><head>
    <title>${headline}</title>
    <meta property="og:title" content="${headline}">
    <meta property="og:image" content="https://example.no/og.jpg">
    <script type="application/ld+json">${JSON.stringify(ld)}</script>
  </head><body><h1>${headline}</h1><article><p>Body shown to humans (we ignore this when JSON-LD wins).</p></article></body></html>`;
}

describe("extractArticle — JSON-LD strategy", () => {
  it("wins when articleBody is full-length", () => {
    const html = jsonLdPage({
      headline: "Regjeringen lanserer ny KI-strategi",
      body: FULL_BODY,
      datePublished: "2026-04-15T08:00:00Z",
      dateModified: "2026-04-15T10:30:00Z",
      author: "Ola Nordmann",
      lang: "no",
    });
    const r = extractArticle(html);
    expect(r.extraction_strategy_used).toBe("jsonld");
    expect(r.extraction_quality).toBe("full");
    expect(r.headline).toBe("Regjeringen lanserer ny KI-strategi");
    expect(r.byline).toBe("Ola Nordmann");
    expect(r.published_at).toBe("2026-04-15T08:00:00Z");
    expect(r.last_modified_at).toBe("2026-04-15T10:30:00Z");
    expect(r.language).toBe("no");
    expect(r.body_text).toContain("kunstig intelligens");
    expect(r.lede).toMatch(/^Regjeringen presenterer/);
    expect(r.word_count).toBeGreaterThan(50);
    expect(r.og_image_url).toBeTruthy();
  });

  it("buckets as 'partial' when articleBody is in 200..999 chars", () => {
    const shortBody = "Kort tekst om kunstig intelligens. ".repeat(8);
    expect(shortBody.length).toBeGreaterThanOrEqual(200);
    expect(shortBody.length).toBeLessThan(1000);
    const html = jsonLdPage({ headline: "X", body: shortBody, lang: "no" });
    const r = extractArticle(html);
    expect(r.extraction_strategy_used).toBe("jsonld");
    expect(r.extraction_quality).toBe("partial");
  });

  it("relabels strategy as 'amp' when viaAmp option set", () => {
    const html = jsonLdPage({ headline: "X", body: FULL_BODY, lang: "no" });
    const r = extractArticle(html, { viaAmp: true });
    expect(r.extraction_strategy_used).toBe("amp");
    expect(r.extraction_quality).toBe("full");
  });

  it("normalizes locale-style language strings", () => {
    const html = jsonLdPage({ headline: "X", body: FULL_BODY, lang: "nb-NO" });
    const r = extractArticle(html);
    expect(r.language).toBe("no");
  });

  it("surfaces amp_url hint from <link rel='amphtml'>", () => {
    const headHtml = `<!doctype html><html><head>
      <link rel="amphtml" href="https://example.no/amp/article-123">
      <meta property="og:title" content="Headline">
      <meta property="og:description" content="A short teaser">
    </head><body></body></html>`;
    const r = extractArticle(headHtml);
    expect(r.amp_url).toBe("https://example.no/amp/article-123");
  });
});

describe("extractArticle — readability fallback", () => {
  it("activates when JSON-LD is missing or too short", () => {
    const paragraphs = Array.from({ length: 8 }, (_, i) =>
      `<p>Avsnitt ${i + 1} om kunstig intelligens og maskinlæring i norsk offentlig sektor med utfyllende tekst som overstiger minstegrensen for hver paragraf, slik at total kroppstekst kommer komfortabelt over tusen tegn og dermed havner i full kvalitet.</p>`
    ).join("");
    const html = `<!doctype html><html lang="no"><head>
      <title>Headline</title>
      <meta property="og:title" content="Readability Headline">
      <meta property="og:description" content="ignored teaser">
    </head><body>
      <header><nav><p>Forsiden</p></nav></header>
      <article>
        <h1>Readability Headline</h1>
        ${paragraphs}
      </article>
      <footer><p>Copyright</p></footer>
    </body></html>`;
    const r = extractArticle(html);
    expect(r.extraction_strategy_used).toBe("readability");
    expect(r.extraction_quality).toBe("full");
    expect(r.headline).toBe("Readability Headline");
    expect(r.body_text).toContain("Avsnitt 1");
    expect(r.body_text).not.toContain("Forsiden");
    expect(r.body_text).not.toContain("Copyright");
  });

  it("ignores <script> and <style> blocks inside article", () => {
    const paragraphs = Array.from({ length: 5 }, () =>
      `<p>Substantial paragraph about AI policy that easily exceeds the minimum length threshold for inclusion.</p>`
    ).join("");
    const html = `<html><head><meta property="og:title" content="X"></head><body>
      <article>
        <script>window.tracker.send({hidden:true})</script>
        <style>.ad{display:none}</style>
        ${paragraphs}
      </article>
    </body></html>`;
    const r = extractArticle(html);
    expect(r.body_text).not.toContain("tracker.send");
    expect(r.body_text).not.toContain("display:none");
  });
});

describe("extractArticle — og-only fallback", () => {
  it("returns metadata-only quality when only og:description is present", () => {
    const html = `<!doctype html><html lang="no"><head>
      <meta property="og:title" content="Paywalled article">
      <meta property="og:description" content="A short teaser visible to scrapers; the body is behind a paywall.">
      <meta property="og:image" content="https://example.no/img.jpg">
      <meta property="article:published_time" content="2026-04-15T08:00:00Z">
    </head><body><div id="paywall">Subscribe to read</div></body></html>`;
    const r = extractArticle(html);
    expect(r.extraction_strategy_used).toBe("og-only");
    expect(r.extraction_quality).toBe("metadata-only");
    expect(r.headline).toBe("Paywalled article");
    expect(r.body_text).toContain("teaser");
    expect(r.published_at).toBe("2026-04-15T08:00:00Z");
    expect(r.og_image_url).toBe("https://example.no/img.jpg");
  });

  it("returns extract_failed when nothing useful is present", () => {
    const html = `<html><body><div>No metadata, no article.</div></body></html>`;
    const r = extractArticle(html);
    expect(r.extraction_strategy_used).toBe("extract_failed");
    expect(r.extraction_quality).toBe("extract_failed");
    expect(r.headline).toBeNull();
  });
});

describe("extractArticle — JSON-LD shape tolerance", () => {
  it("walks @graph arrays to find NewsArticle", () => {
    const ld = {
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebSite", name: "Site" },
        { "@type": "NewsArticle", headline: "Inside graph", articleBody: FULL_BODY, inLanguage: "no" },
      ],
    };
    const html = `<html><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body></body></html>`;
    const r = extractArticle(html);
    expect(r.headline).toBe("Inside graph");
    expect(r.extraction_strategy_used).toBe("jsonld");
  });

  it("picks the longest articleBody when multiple Articles are present", () => {
    const ld1 = { "@type": "Article", headline: "Promo", articleBody: "short" };
    const ld2 = { "@type": "NewsArticle", headline: "Real", articleBody: FULL_BODY };
    const html = `<html><head>
      <script type="application/ld+json">${JSON.stringify(ld1)}</script>
      <script type="application/ld+json">${JSON.stringify(ld2)}</script>
    </head><body></body></html>`;
    const r = extractArticle(html);
    expect(r.headline).toBe("Real");
  });

  it("handles @type as an array", () => {
    const ld = { "@type": ["NewsArticle", "ReportageNewsArticle"], headline: "Multi", articleBody: FULL_BODY, inLanguage: "no" };
    const html = `<html><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body></body></html>`;
    const r = extractArticle(html);
    expect(r.headline).toBe("Multi");
  });

  it("survives malformed JSON-LD", () => {
    const html = `<html><head>
      <script type="application/ld+json">{not valid json}</script>
      <meta property="og:title" content="Fallback">
      <meta property="og:description" content="The og description still rescues this page.">
    </head><body></body></html>`;
    const r = extractArticle(html);
    expect(r.extraction_strategy_used).toBe("og-only");
    expect(r.headline).toBe("Fallback");
  });
});

describe("decodeEntities", () => {
  it("decodes named, decimal, and hex entities", () => {
    expect(decodeEntities("Tom &amp; Jerry")).toBe("Tom & Jerry");
    expect(decodeEntities("&#39;hi&#39;")).toBe("'hi'");
    expect(decodeEntities("&#x2014;")).toBe("—");
    expect(decodeEntities("M&aring;l")).toBe("Mål");
  });
});
