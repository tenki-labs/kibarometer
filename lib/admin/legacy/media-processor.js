// lib/admin/legacy/media-processor.js
// Pure-function module that turns an extracted article (from media-extract)
// into a media_articles row, plus the URL-normalization + hash helpers
// shared between the discover and fetch-classify workers.
//
// Mirrors `nav-processor.js` shape; reuses `applyTags`/`compileMatchers` so
// the keyword-matching semantics stay identical across the jobs and media
// pipelines (one source of truth for word-boundary handling on Norwegian
// strings). Re-exported here so PR 3+ can import either origin.
//
// Tier 1 / Tier 2 columns are intentionally left null on insert — those
// flow through the LLM workers in PR 6.

import { createHash } from "node:crypto";
import { applyTags, compileMatchers } from "./nav-processor.js";
import { simhash, toPgBigint } from "./media-simhash.js";

export { applyTags, compileMatchers };

// Tracking-param strip-list. Conservative: only the universally-recognized
// "marketing came from here" parameters. We do NOT strip query terms a site
// uses for actual content addressing — that would alias distinct articles.
const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
  "fbclid", "gclid", "msclkid", "mc_cid", "mc_eid", "_ga", "ref", "ref_src",
]);

// Canonicalize a URL for dedupe. Lowercases host, strips fragment, drops
// known tracking params, removes a trailing slash on the path (unless the
// path IS just "/"). Returns null on malformed input rather than throwing.
export function canonicalizeUrl(raw) {
  if (!raw || typeof raw !== "string") return null;
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.hash = "";
  u.host = u.host.toLowerCase();
  // Sort retained params for stable hashing across discoveries that arrived
  // in different orders.
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAMS.has(k.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b));
  u.search = "";
  for (const [k, v] of params) u.searchParams.append(k, v);
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.replace(/\/+$/, "");
  }
  return u.toString();
}

// 64-hex sha256 over the canonicalized URL. Used as the UNIQUE key in
// media_url_queue and media_articles so re-discovery is an idempotent
// no-op.
export function urlHash(url) {
  const canonical = canonicalizeUrl(url) ?? String(url);
  return createHash("sha256").update(canonical).digest("hex");
}

// Build the haystack we run the keyword matcher against. Tier-1 LLM only
// sees headline+lede, so the keyword filter sees the same shape plus a
// modest body-prefix when we have full-quality extraction. Larger windows
// would just add noise without catching meaningfully more AI articles.
export function buildHaystack({ headline, lede, body_text, extraction_quality }) {
  const parts = [];
  if (headline) parts.push(String(headline));
  if (lede) parts.push(String(lede));
  if (body_text && (extraction_quality === "full" || extraction_quality === "partial")) {
    parts.push(String(body_text).slice(0, 500));
  }
  return parts.join("\n");
}

// Compute the simhash basis: headline + first 300 chars of body. Falls back
// to lede if body is empty (metadata-only quality). The wire-cluster matcher
// in PR 3 SQL queries within a 24h window using this column.
function deriveSimhashBasis({ headline, lede, body_text }) {
  const head = headline ? String(headline) : "";
  const tail = body_text
    ? String(body_text).slice(0, 300)
    : lede
      ? String(lede)
      : "";
  return `${head}\n${tail}`.trim();
}

// Map an extracted article + source + URL → a media_articles insert row.
// Pure: no I/O, no SQL. The orchestrator is responsible for the upsert and
// for assigning `wire_cluster_id` after a SQL similarity probe.
//
// `discoveredAt` defaults to now() but is parameterized so backfill can
// pass the discovery timestamp from the queue row, keeping the original
// observation time intact.
//
// `ingestMode` ('live' | 'backfill') propagates from the queue row —
// media-discover enqueues 'live', media-backfill enqueues 'backfill', and
// media-fetch-classify carries the value forward into media_articles.
// An omitted/undefined value silently falls through to the table's
// `default 'backfill'` (the CHECK only fires on values outside the enum),
// so callers must pass the right mode to avoid silent backfill stamping.
export function buildArticleRow({ url, sourceId, extracted, matchers, discoveredAt = null, ingestMode }) {
  const canonical = canonicalizeUrl(url);
  const hash = urlHash(url);
  const haystack = buildHaystack(extracted);
  const tags = applyTags(haystack, matchers);
  const sim = simhash(deriveSimhashBasis(extracted));
  const now = discoveredAt || new Date().toISOString();

  return {
    source_id: sourceId,
    url: canonical || url,
    url_hash: hash,
    headline: extracted.headline,
    byline: extracted.byline,
    published_at: extracted.published_at,
    last_modified_at: extracted.last_modified_at,
    language: extracted.language || "no",
    word_count: extracted.word_count ?? 0,
    og_image_url: extracted.og_image_url,
    is_ai_related: tags.is_ai,
    matched_keywords: tags.matched_keywords,
    match_method: tags.is_ai ? "keyword" : null,
    extraction_quality: extracted.extraction_quality,
    extraction_strategy_used: extracted.extraction_strategy_used,
    simhash: toPgBigint(sim),
    last_seen_at: now,
    ingest_mode: ingestMode,
    // Tier 1/2 and wire_cluster_id are left null on insert; downstream
    // workers fill them.
    tier1_completed_at: null,
    llm_ai_phrases: null,
    tier2_completed_at: null,
    llm_categories: null,
    llm_stance: null,
    llm_intensity: null,
    llm_taxonomy_version: null,
    llm_prompt_id: null,
    llm_model_version: null,
    wire_cluster_id: null,
  };
}

// Cheap pre-fetch filter for RSS/Atom items. RSS feeds carry title + a short
// description inline; if neither matches the keyword catalogue we skip the
// fetch entirely (Stage 1 of the cascade — see PRD §"Filter cascade").
export function rssItemMatchesKeywords({ title, description }, matchers) {
  const haystack = `${title || ""}\n${description || ""}`;
  return applyTags(haystack, matchers);
}

// Shared keyword loader for the media pipeline. Pulls both `media`-domain
// terms (specific to this pipeline) and `any`-domain terms (universal AI
// vocabulary shared with the jobs pipeline). Trial keywords match here so
// they show up in admin observability — promotion to canonical happens in
// the same review flow as the jobs pipeline.
export async function loadActiveMediaKeywords(sb) {
  return sb(
    "/keywords?status=in.(canonical,trial)&domain=in.(media,any)" +
      "&select=term,language,category,match_type",
    { service: true },
  );
}
