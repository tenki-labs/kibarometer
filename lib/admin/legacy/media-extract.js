// lib/admin/legacy/media-extract.js
// Tiered article extractor. Pure function: HTML in, structured fields out,
// no I/O, no fetching. The orchestrator decides whether to follow up on the
// AMP hint with a second fetch.
//
// Strategy order (cheap → expensive, stop on first hit ≥ partial quality):
//   jsonld       — parse <script type="application/ld+json">, find a
//                  NewsArticle/Article node, read articleBody. Wins on
//                  ~80% of Norwegian outlets, including paywalled pages
//                  whose JSON-LD still carries the full body for Google
//                  News indexing.
//   readability  — heuristic: largest <article>/<main> block, then the
//                  longest run of <p> tags inside the largest text-bearing
//                  container, dropping nav/header/footer/aside/form.
//   og-only      — meta description + first visible <p>. Last-resort.
//
// AMP isn't a strategy here — it's a fetch hint. If JSON-LD fails and we
// surface `amp_url`, the orchestrator can re-fetch the AMP variant and call
// extract again; the second call is given { viaAmp: true } so the resulting
// strategy is labelled 'amp' rather than 'jsonld'/'readability'.
//
// Output never contains the full HTML. body_text is capped to BODY_CAP chars
// (currently 8000) — Tier 2's prompt only consumes ~6k tokens of body, so
// the rest is wasted bandwidth. The cap also acts as a safety net against
// pathological pages.

const BODY_CAP = 8000;
const FULL_THRESHOLD = 1000;
const PARTIAL_THRESHOLD = 200;

// ---- HTML primitives ---------------------------------------------------

const ENTITY = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  laquo: "«", raquo: "»", hellip: "…", mdash: "—", ndash: "–",
  oslash: "ø", aelig: "æ", aring: "å",
  Oslash: "Ø", AElig: "Æ", Aring: "Å",
};

export function decodeEntities(s) {
  if (!s) return "";
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => (ENTITY[name] != null ? ENTITY[name] : m));
}

function safeChar(code) {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try { return String.fromCodePoint(code); } catch { return ""; }
}

function stripTags(html) {
  return decodeEntities(String(html || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

// Read attribute value off a single tag's text. Tolerates either quote style
// and unquoted attrs. Used for og: meta extraction where the order of
// `property=` and `content=` varies.
function attr(tag, name) {
  const re = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i");
  const m = tag.match(re);
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? "") : null;
}

// ---- JSON-LD strategy --------------------------------------------------

const ARTICLE_TYPES = new Set([
  "newsarticle", "article", "reportagenewsarticle", "analysisnewsarticle",
  "backgroundnewsarticle", "opinionnewsarticle", "reviewnewsarticle",
  "blogposting", "liveblogposting",
]);

// Walk a JSON-LD value (object, array, or @graph) and yield every node that
// looks like an article. Tolerates @type as either a string or an array of
// strings (Schema.org allows multi-type).
function* iterArticleNodes(node) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) yield* iterArticleNodes(item);
    return;
  }
  if (Array.isArray(node["@graph"])) {
    for (const item of node["@graph"]) yield* iterArticleNodes(item);
  }
  const t = node["@type"];
  const types = Array.isArray(t) ? t : t ? [t] : [];
  for (const ty of types) {
    if (ARTICLE_TYPES.has(String(ty).toLowerCase())) {
      yield node;
      break;
    }
  }
}

function pickAuthorName(author) {
  if (!author) return null;
  if (typeof author === "string") return author.trim() || null;
  if (Array.isArray(author)) {
    return author.map(pickAuthorName).filter(Boolean).join(", ") || null;
  }
  if (typeof author === "object") {
    return (author.name && String(author.name).trim()) || null;
  }
  return null;
}

function extractFromJsonLd(html) {
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const candidates = [];
  let m;
  while ((m = re.exec(html))) {
    const raw = m[1].trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      for (const node of iterArticleNodes(parsed)) candidates.push(node);
    } catch {
      // Some outlets concatenate multiple JSON objects in one script — try
      // splitting on `}{` as a hail-mary. Rare; ignore failures.
      try {
        const fixed = `[${raw.replace(/}\s*{/g, "},{")}]`;
        const parsed = JSON.parse(fixed);
        for (const node of iterArticleNodes(parsed)) candidates.push(node);
      } catch { /* swallow */ }
    }
  }
  if (!candidates.length) return null;

  // Pick the candidate with the longest articleBody. Some pages embed both
  // the article and a navigation element typed Article; longest-body wins.
  let best = null;
  let bestLen = -1;
  for (const c of candidates) {
    const len = String(c.articleBody || "").length;
    if (len > bestLen) { best = c; bestLen = len; }
  }
  if (!best) return null;
  const body = String(best.articleBody || "").trim();
  return {
    headline: best.headline ? String(best.headline).trim() : null,
    byline: pickAuthorName(best.author),
    published_at: best.datePublished || null,
    last_modified_at: best.dateModified || null,
    language: best.inLanguage ? String(best.inLanguage).slice(0, 8) : null,
    body_text: body || null,
    og_image_url: pickJsonLdImage(best.image),
  };
}

function pickJsonLdImage(image) {
  if (!image) return null;
  if (typeof image === "string") return image;
  if (Array.isArray(image)) return pickJsonLdImage(image[0]);
  if (typeof image === "object") {
    return image.url ? String(image.url) : null;
  }
  return null;
}

// ---- Meta + AMP extraction --------------------------------------------

function extractMeta(html) {
  const headMatch = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
  const head = headMatch ? headMatch[1] : html;

  const meta = {};
  const tagRe = /<meta\s+[^>]*>/gi;
  let m;
  while ((m = tagRe.exec(head))) {
    const tag = m[0];
    const key = (attr(tag, "property") || attr(tag, "name") || "").toLowerCase();
    if (!key) continue;
    const value = attr(tag, "content");
    if (value != null && meta[key] == null) meta[key] = value;
  }

  // <link rel="amphtml" href="...">
  const ampMatch = head.match(/<link\s+[^>]*rel\s*=\s*["']amphtml["'][^>]*>/i);
  const amp_url = ampMatch ? attr(ampMatch[0], "href") : null;

  // <html lang="...">
  const htmlTag = html.match(/<html\b[^>]*>/i);
  const lang = htmlTag ? attr(htmlTag[0], "lang") : null;

  // <title>
  const titleMatch = head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripTags(titleMatch[1]) : null;

  return { meta, amp_url, lang, title };
}

// ---- Readability strategy ---------------------------------------------

const NOISE_TAGS = ["script", "style", "noscript", "template", "iframe", "svg", "form"];
const STRUCTURAL_NOISE = ["nav", "header", "footer", "aside"];

function stripNoise(html) {
  let out = html;
  for (const tag of NOISE_TAGS) {
    const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
    out = out.replace(re, " ");
  }
  for (const tag of STRUCTURAL_NOISE) {
    const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
    out = out.replace(re, " ");
  }
  // HTML comments
  out = out.replace(/<!--[\s\S]*?-->/g, " ");
  return out;
}

// Pull the first <article> or <main> block; fall back to <body>.
function pickContainer(html) {
  for (const tag of ["article", "main"]) {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
    const m = html.match(re);
    if (m && m[1].length > 500) return m[1];
  }
  const body = html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i);
  return body ? body[1] : html;
}

function extractParagraphs(container) {
  const out = [];
  const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(container))) {
    const text = stripTags(m[1]);
    // Skip nav/breadcrumb-ish noise paragraphs.
    if (text.length >= 30) out.push(text);
  }
  return out;
}

function extractFromReadability(html) {
  const cleaned = stripNoise(html);
  const container = pickContainer(cleaned);
  const paragraphs = extractParagraphs(container);
  if (!paragraphs.length) return null;
  const body = paragraphs.join("\n\n");
  return body.trim() ? { body_text: body, lede: paragraphs[0] } : null;
}

// ---- Headline fallback -------------------------------------------------

function extractH1(html) {
  const m = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  return m ? stripTags(m[1]) : null;
}

// ---- Quality bucketing -------------------------------------------------

function bucketQuality(bodyLen) {
  if (bodyLen >= FULL_THRESHOLD) return "full";
  if (bodyLen >= PARTIAL_THRESHOLD) return "partial";
  if (bodyLen > 0) return "metadata-only";
  return "extract_failed";
}

function wordCount(text) {
  if (!text) return 0;
  const m = text.match(/\S+/g);
  return m ? m.length : 0;
}

// Take the first sentence-ish chunk for `lede`. Norwegian abbreviations
// (bl.a., dvs., osv.) trip naive regex; we cap at 280 chars regardless so
// the worst-case is a slightly over-long lede, not a crash.
function deriveLede(body) {
  if (!body) return null;
  const cleaned = body.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  const m = cleaned.match(/^[\s\S]{20,280}?[.!?](?:\s|$)/);
  return (m ? m[0] : cleaned.slice(0, 280)).trim();
}

// ---- Public API --------------------------------------------------------

// Run the cascade. Pass `viaAmp: true` when the HTML came from an AMP URL
// (so the strategy label reads 'amp' instead of leaking the inner method).
export function extractArticle(html, { viaAmp = false } = {}) {
  if (!html || typeof html !== "string") {
    return failResult();
  }

  const meta = extractMeta(html);
  const ogTitle = meta.meta["og:title"] || meta.meta["twitter:title"] || meta.title || null;
  const ogDesc = meta.meta["og:description"] || meta.meta["twitter:description"] || null;
  const ogImage = meta.meta["og:image"] || meta.meta["twitter:image"] || null;
  const ogPublished = meta.meta["article:published_time"] || meta.meta["og:article:published_time"] || null;
  const ogModified = meta.meta["article:modified_time"] || meta.meta["og:article:modified_time"] || null;
  const ogLang = meta.meta["og:locale"] || null;

  const jsonld = extractFromJsonLd(html);
  if (jsonld?.body_text && jsonld.body_text.length >= PARTIAL_THRESHOLD) {
    return finalize({
      headline: jsonld.headline || ogTitle || extractH1(html),
      byline: jsonld.byline || meta.meta["author"] || null,
      published_at: jsonld.published_at || ogPublished,
      last_modified_at: jsonld.last_modified_at || ogModified,
      language: normalizeLang(jsonld.language || meta.lang || ogLang),
      body_text: jsonld.body_text,
      og_image_url: jsonld.og_image_url || ogImage,
      amp_url: meta.amp_url,
      strategy: viaAmp ? "amp" : "jsonld",
    });
  }

  const reader = extractFromReadability(html);
  if (reader?.body_text && reader.body_text.length >= PARTIAL_THRESHOLD) {
    return finalize({
      headline: jsonld?.headline || ogTitle || extractH1(html),
      byline: jsonld?.byline || meta.meta["author"] || null,
      published_at: jsonld?.published_at || ogPublished,
      last_modified_at: jsonld?.last_modified_at || ogModified,
      language: normalizeLang(jsonld?.language || meta.lang || ogLang),
      body_text: reader.body_text,
      og_image_url: jsonld?.og_image_url || ogImage,
      amp_url: meta.amp_url,
      strategy: viaAmp ? "amp" : "readability",
    });
  }

  // og-only fallback. We accept whatever metadata is present; quality bucket
  // does the honest labelling downstream.
  const ogBody = ogDesc ? ogDesc.trim() : "";
  if (ogTitle || ogBody) {
    return finalize({
      headline: jsonld?.headline || ogTitle || extractH1(html),
      byline: jsonld?.byline || meta.meta["author"] || null,
      published_at: jsonld?.published_at || ogPublished,
      last_modified_at: jsonld?.last_modified_at || ogModified,
      language: normalizeLang(jsonld?.language || meta.lang || ogLang),
      body_text: ogBody || null,
      og_image_url: jsonld?.og_image_url || ogImage,
      amp_url: meta.amp_url,
      strategy: viaAmp ? "amp" : "og-only",
    });
  }

  return failResult({ amp_url: meta.amp_url, og_image_url: ogImage });
}

function normalizeLang(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase().trim();
  if (s.startsWith("nb") || s.startsWith("nn") || s === "no" || s === "no_no") return "no";
  if (s.startsWith("en")) return "en";
  return s.slice(0, 8) || null;
}

function finalize({ headline, byline, published_at, last_modified_at, language, body_text, og_image_url, amp_url, strategy }) {
  const cappedBody = body_text ? body_text.slice(0, BODY_CAP) : null;
  const lede = deriveLede(cappedBody);
  const wc = wordCount(cappedBody);
  const quality = bucketQuality(cappedBody?.length ?? 0);
  return {
    headline: headline ? headline.trim() || null : null,
    byline: byline ? byline.trim() || null : null,
    published_at: published_at || null,
    last_modified_at: last_modified_at || null,
    language: language || null,
    lede: lede || null,
    body_text: cappedBody,
    word_count: wc,
    og_image_url: og_image_url || null,
    amp_url: amp_url || null,
    extraction_strategy_used: strategy,
    extraction_quality: quality,
  };
}

function failResult(extra = {}) {
  return {
    headline: null,
    byline: null,
    published_at: null,
    last_modified_at: null,
    language: null,
    lede: null,
    body_text: null,
    word_count: 0,
    og_image_url: extra.og_image_url || null,
    amp_url: extra.amp_url || null,
    extraction_strategy_used: "extract_failed",
    extraction_quality: "extract_failed",
  };
}

export const _internals = { stripTags, stripNoise, extractFromJsonLd, extractMeta, extractFromReadability };
