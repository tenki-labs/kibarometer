// lib/admin/legacy/media-sitemap.js
// Long-tail backfill fallback for outlets without a usable search page.
// Walks sitemap.xml (and optionally a sitemap-index pointing at monthly
// children), returns a flat list of article URLs. The fetch-classify
// worker filters via the keyword cascade post-fetch — that's the cost
// of this path, and why search-based discovery is preferred when the
// outlet exposes one.
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
 * @param {() => number} [args.now]
 */
export async function walkSitemap({
  source,
  fetcher,
  limit = DEFAULT_LIMIT,
  maxWallMs = DEFAULT_MAX_WALL_MS,
  now = () => Date.now(),
}) {
  if (!source?.sitemap_url) {
    throw new Error("sitemap_url mangler");
  }
  const startMs = now();
  const out = new Set();
  const queue = [source.sitemap_url];
  const seen = new Set([source.sitemap_url]);
  let fetched = 0;
  let failed = 0;
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
    const { childSitemaps, locs } = parseSitemap(res.body);
    for (const u of locs) {
      if (out.size >= limit) break;
      out.add(u);
    }
    if (source.sitemap_index !== false) {
      for (const c of childSitemaps) {
        if (seen.has(c)) continue;
        seen.add(c);
        queue.push(c);
      }
    }
  }

  return {
    urls: Array.from(out).slice(0, limit),
    stats: { fetched, failed, urls_found: out.size, stopped },
  };
}

// Tolerant XML parser. Sitemaps are well-defined enough that a regex pass
// over <sitemap><loc> and <url><loc> blocks is sufficient — pulling in a
// real XML parser would buy zero precision and add a dep we don't need.
//
// Returns { childSitemaps, locs }. If the sitemap is a flat <urlset>,
// childSitemaps will be empty. If it's a <sitemapindex>, locs will be empty.
export function parseSitemap(xml) {
  const childSitemaps = [];
  const locs = [];
  if (!xml || typeof xml !== "string") return { childSitemaps, locs };

  const sitemapRe = /<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/gi;
  let m;
  while ((m = sitemapRe.exec(xml)) !== null) {
    const loc = readLoc(m[1]);
    if (loc) childSitemaps.push(loc);
  }

  const urlRe = /<url\b[^>]*>([\s\S]*?)<\/url>/gi;
  while ((m = urlRe.exec(xml)) !== null) {
    const loc = readLoc(m[1]);
    if (loc) locs.push(loc);
  }
  return { childSitemaps, locs };
}

function readLoc(block) {
  const m = block.match(/<loc[^>]*>([\s\S]*?)<\/loc>/i);
  if (!m) return null;
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim() || null;
}

export const _internals = { parseSitemap, readLoc };
