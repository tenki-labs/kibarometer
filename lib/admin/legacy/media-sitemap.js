// lib/admin/legacy/media-sitemap.js
// Long-tail backfill walker. Crawls sitemap.xml (and optionally a
// sitemap-index pointing at monthly children), returns a flat list of
// article URLs. The fetch-classify worker filters via the keyword
// cascade post-fetch — that's the cost of this path.
//
// Used for historical 2020-onwards backfill where DDG can't reach
// (DuckDuckGo's index doesn't go that far back reliably). Sitemap
// walking is deterministic and lets us filter by <lastmod> so we don't
// drag every URL ever published — only what falls inside the requested
// time window.
//
// Pure orchestration over `fetchSitemap` — no DB writes.

import { fetchSitemap } from "./media-client.js";

const DEFAULT_LIMIT = 1000;
const DEFAULT_MAX_WALL_MS = 30_000;
const MAX_CHILD_SITEMAPS = 200;

/**
 * @param {object} args
 * @param {{ id: string, domain: string, sitemap_url: string|null, sitemap_index?: boolean, crawl_delay_ms?: number }} args.source
 * @param {Function} [args.fetcher]
 * @param {number} [args.limit]
 * @param {number} [args.maxWallMs]
 * @param {Date|string} [args.since]   Optional ISO date / Date. <url>
 *   entries with `<lastmod>` strictly before this are skipped, and
 *   child sitemaps with `<lastmod>` strictly before this are not
 *   descended into. Entries with no `<lastmod>` are included (we can't
 *   tell — let downstream filtering catch them).
 * @param {() => number} [args.now]
 */
export async function walkSitemap({
  source,
  fetcher,
  limit = DEFAULT_LIMIT,
  maxWallMs = DEFAULT_MAX_WALL_MS,
  since,
  now = () => Date.now(),
}) {
  if (!source?.sitemap_url) {
    throw new Error("sitemap_url mangler");
  }
  const sinceMs = since ? new Date(since).getTime() : null;
  if (sinceMs != null && Number.isNaN(sinceMs)) {
    throw new Error(`walkSitemap: ugyldig since=${String(since)}`);
  }

  const startMs = now();
  const out = new Set();
  const queue = [source.sitemap_url];
  const seen = new Set([source.sitemap_url]);
  let fetched = 0;
  let failed = 0;
  let urlsFilteredByDate = 0;
  let subsitemapsSkippedByLastmod = 0;
  let stopped = "completed";

  while (queue.length > 0 && out.size < limit) {
    if (now() - startMs > maxWallMs) {
      stopped = "wall_time";
      break;
    }
    if (fetched >= MAX_CHILD_SITEMAPS) {
      stopped = "max_sitemaps";
      break;
    }
    const url = queue.shift();
    const res = await fetchSitemap(url, {
      crawlDelayMs: source.crawl_delay_ms,
      ...(fetcher ? { fetcher } : {}),
    });
    if (!res.ok) {
      failed += 1;
      continue;
    }
    fetched += 1;
    const { childSitemaps, urls } = parseSitemap(res.body);
    for (const entry of urls) {
      if (out.size >= limit) break;
      if (sinceMs != null && entry.lastmod && entry.lastmod < sinceMs) {
        urlsFilteredByDate += 1;
        continue;
      }
      out.add(entry.loc);
    }
    if (source.sitemap_index !== false) {
      for (const child of childSitemaps) {
        if (seen.has(child.loc)) continue;
        // Skip sub-sitemaps whose own <lastmod> is older than the
        // window. Common pattern: outlets expose a per-month sitemap
        // index; with since=2020-01-01 we can skip every monthly
        // sitemap from 2010-2019 without fetching them.
        if (sinceMs != null && child.lastmod && child.lastmod < sinceMs) {
          subsitemapsSkippedByLastmod += 1;
          continue;
        }
        seen.add(child.loc);
        queue.push(child.loc);
      }
    }
  }

  return {
    urls: Array.from(out).slice(0, limit),
    stats: {
      fetched,
      failed,
      urls_found: out.size,
      urls_filtered_by_date: urlsFilteredByDate,
      subsitemaps_skipped_by_lastmod: subsitemapsSkippedByLastmod,
      stopped,
    },
  };
}

// Tolerant XML parser. Sitemaps are well-defined enough that a regex pass
// over <sitemap> and <url> blocks is sufficient — pulling in a real XML
// parser would buy zero precision and add a dep we don't need.
//
// Returns { childSitemaps, urls }. Each entry has { loc, lastmod } where
// lastmod is milliseconds-since-epoch or null. If the sitemap is a flat
// <urlset>, childSitemaps will be empty. If it's a <sitemapindex>, urls
// will be empty.
export function parseSitemap(xml) {
  const childSitemaps = [];
  const urls = [];
  if (!xml || typeof xml !== "string") return { childSitemaps, urls };

  const sitemapRe = /<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/gi;
  let m;
  while ((m = sitemapRe.exec(xml)) !== null) {
    const entry = readEntry(m[1]);
    if (entry) childSitemaps.push(entry);
  }

  const urlRe = /<url\b[^>]*>([\s\S]*?)<\/url>/gi;
  while ((m = urlRe.exec(xml)) !== null) {
    const entry = readEntry(m[1]);
    if (entry) urls.push(entry);
  }
  return { childSitemaps, urls };
}

function readEntry(block) {
  const locMatch = block.match(/<loc[^>]*>([\s\S]*?)<\/loc>/i);
  if (!locMatch) return null;
  const loc = locMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
  if (!loc) return null;

  // Sitemaps spec uses W3C datetime; in practice we see ISO 8601 in many
  // shapes (date only, date+time, with/without timezone). Date.parse is
  // tolerant enough for all common cases. Returns null for unparseable.
  let lastmod = null;
  const lastmodMatch = block.match(/<lastmod[^>]*>([\s\S]*?)<\/lastmod>/i);
  if (lastmodMatch) {
    const raw = lastmodMatch[1]
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .trim();
    const parsed = raw ? Date.parse(raw) : NaN;
    if (!Number.isNaN(parsed)) lastmod = parsed;
  }
  return { loc, lastmod };
}

export const _internals = { parseSitemap, readEntry };
