// lib/admin/legacy/media-search.js
// Per-outlet site-search adapter. Drives the `media-backfill` orchestrator's
// default path: take a source's `search_config`, iterate (queries × pages),
// extract article-like URLs from each result page, return them deduped.
//
// search_config shape (jsonb on media_sources):
//   {
//     url_template: "https://www.example.no/sok?q={q}&page={page}",
//     queries: ["AI", "KI", "kunstig intelligens", ...],
//     result_selector?: "article a",     // hint, currently advisory
//     next_page_selector?: "a[rel=next]", // hint, advisory
//     max_pages_per_query?: 50            // optional hard cap
//   }
//
// We don't ship a CSS-selector engine — `result_selector` is recorded for
// the operator but the URL extraction uses a tolerant heuristic (any <a>
// pointing at the source's domain that doesn't look like a search/category/
// pagination/feed URL). In practice that's robust enough for Norwegian
// outlets, and the operator tunes the keyword list (which IS load-bearing)
// rather than fighting selectors. If a particular outlet over-matches we'd
// add a selector engine then; for v1 the keyword list does the filtering.
//
// Pure orchestration over `fetchHtml` — no DB writes, no side effects beyond
// the polite HTTP fetch. The backfill orchestrator handles enqueue.

import { fetchHtml } from "./media-client.js";

const DEFAULT_MAX_PAGES = 10;
const HARD_PAGE_CAP = 50;

/**
 * @param {object} args
 * @param {{ id: string, domain: string, search_config: any, crawl_delay_ms?: number }} args.source
 * @param {Function} [args.fetcher]
 * @param {number} [args.maxPages]      override of search_config.max_pages_per_query
 * @param {number} [args.maxWallMs]     wall-clock budget (default 30 s)
 * @param {() => number} [args.now]
 */
export async function searchSourceUrls({
  source,
  fetcher,
  maxPages,
  maxWallMs = 30_000,
  now = () => Date.now(),
}) {
  const cfg = source.search_config;
  if (!cfg || typeof cfg !== "object") {
    throw new Error("search_config mangler");
  }
  if (!cfg.url_template || typeof cfg.url_template !== "string") {
    throw new Error("search_config.url_template mangler");
  }
  if (!Array.isArray(cfg.queries) || cfg.queries.length === 0) {
    throw new Error("search_config.queries er tom");
  }

  const limit = Math.min(
    maxPages ?? cfg.max_pages_per_query ?? DEFAULT_MAX_PAGES,
    HARD_PAGE_CAP,
  );
  const startMs = now();
  const out = new Set();
  const stats = {
    queries: 0,
    pages_fetched: 0,
    pages_failed: 0,
    urls_found: 0,
    stopped: "completed",
  };

  outer: for (const q of cfg.queries) {
    if (typeof q !== "string" || !q.trim()) continue;
    let prevSize = -1;
    for (let page = 1; page <= limit; page += 1) {
      if (now() - startMs > maxWallMs) {
        stats.stopped = "wall_time";
        break outer;
      }
      const url = renderTemplate(cfg.url_template, { q, page });
      const res = await fetchHtml(url, {
        crawlDelayMs: source.crawl_delay_ms,
        ...(fetcher ? { fetcher } : {}),
      });
      if (!res.ok) {
        stats.pages_failed += 1;
        // 404 / robots / 5xx — bail this query, try the next one. If robots
        // disallows /sok, the operator will see that on every query and can
        // switch the source to backfill_method='sitemap'.
        break;
      }
      stats.pages_fetched += 1;
      const found = extractArticleLinks(res.body, source.domain);
      for (const u of found) out.add(u);
      // Stop walking this query when a page returned no new URLs (end of
      // results) or the running set didn't grow at all (the search returned
      // the same page twice — common when the outlet caps results below
      // max_pages_per_query).
      if (found.length === 0 || out.size === prevSize) break;
      prevSize = out.size;
    }
    stats.queries += 1;
  }
  stats.urls_found = out.size;
  return { urls: Array.from(out), stats };
}

// {q} / {page} substitution. Tolerant: missing keys render as empty so a
// template that has e.g. {from}/{to} but no caller-supplied values still
// produces a URL the search endpoint can reject sanely.
export function renderTemplate(tpl, vars) {
  return String(tpl).replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars[k];
    if (v === undefined || v === null) return "";
    return encodeURIComponent(String(v));
  });
}

// Extract article-like URLs from a search results page. Heuristic only —
// any <a href> pointing at the source's domain that doesn't look like a
// search-page / category-index / asset / feed URL.
//
// We strip query strings and fragments before returning so the canonical
// `?utm=…` and tracking-tagged variants of the same article collapse.
export function extractArticleLinks(html, domain) {
  if (!html || !domain) return [];
  const out = new Set();
  const re = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1] || m[2] || m[3];
    if (!raw) continue;
    const url = normaliseUrl(raw, domain);
    if (!url) continue;
    if (!isLikelyArticle(url, domain)) continue;
    out.add(url);
  }
  return Array.from(out);
}

function normaliseUrl(href, domain) {
  const trimmed = String(href).trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("#")) return null;
  if (/^(?:javascript|mailto|tel):/i.test(trimmed)) return null;
  let abs;
  if (trimmed.startsWith("//")) abs = "https:" + trimmed;
  else if (/^https?:\/\//i.test(trimmed)) abs = trimmed;
  else if (trimmed.startsWith("/")) abs = `https://${domain}${trimmed}`;
  else return null; // ignore relative-to-current-page hrefs
  let parsed;
  try {
    parsed = new URL(abs);
  } catch {
    return null;
  }
  // Strip query + fragment so /artikkel/123?utm=foo == /artikkel/123.
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

const SKIP_PATH_RE = /\/(?:sok|search|page|tag|tags|kategori|category|categories|forside|frontpage|seksjon|topic|emne|emner|temaside|sitemap|feed|rss|atom|abonnement|annonse|annonser)(?:\/|$|\?)/i;
const SKIP_EXT_RE = /\.(?:jpg|jpeg|png|gif|webp|svg|ico|css|js|xml|json|pdf|mp3|mp4|webm)$/i;

function isLikelyArticle(url, domain) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.replace(/^www\./, "");
  const root = String(domain).replace(/^www\./, "");
  if (host !== root && !host.endsWith(`.${root}`)) return false;
  const path = parsed.pathname;
  if (!path || path === "/" || path === "") return false;
  if (SKIP_PATH_RE.test(path)) return false;
  if (SKIP_EXT_RE.test(path)) return false;
  // Article URLs typically have at least one slash-separated segment past
  // the root, with some textual content. "/x" passes; "/" already filtered.
  return path.length > 2;
}

export const _internals = { renderTemplate, normaliseUrl, isLikelyArticle };
