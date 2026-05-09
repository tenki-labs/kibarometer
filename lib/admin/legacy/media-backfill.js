// lib/admin/legacy/media-backfill.js
// Per-source backfill orchestrator. Manual trigger only (no cron) — the
// admin UI's "Backfill" button on /admin/media/sources fires this.
//
// One tick = one wall-time-bounded run. The orchestrator picks the
// adapter from media_sources.backfill_method ('site_search' default,
// 'sitemap' fallback), enumerates URLs, enqueues new ones into
// media_url_queue (idempotent on url_hash), and advances
// media_sources.backfill_cursor to today.
//
// `backfill_cursor` is intentionally coarse for v1 — set to today after a
// successful tick. A future iteration can refine it to a per-query date
// window when search_config templates use {from}/{to}; for now operators
// run the button repeatedly until the queue depth flattens.
//
// All inserts go via `media_url_queue` with `Prefer: resolution=ignore-
// duplicates` so re-running a backfill is a no-op for already-discovered
// URLs.

import {
  canonicalizeUrl,
  loadActiveMediaKeywords,
  urlHash,
} from "./media-processor.js";
import { searchSourceUrls } from "./media-search.js";
import { walkSitemap } from "./media-sitemap.js";
import { discoverUrls as scraperDiscoverUrls } from "./media-scraper-client.js";

const JOB_NAME = "media_backfill";
const DEFAULT_WALL_MS = 60_000;
const ENQUEUE_BATCH = 50;

function termsFromKeywords(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((r) => String(r?.term || "").trim())
    .filter(Boolean);
}

/**
 * @param {object} args
 * @param {(path: string, init?: any) => Promise<any>} args.sb
 * @param {string} args.sourceId
 * @param {"manual" | "cron"} [args.trigger]
 * @param {number} [args.maxWallMs]
 * @param {Function} [args.fetcher]
 * @param {() => number} [args.now]
 */
export async function runMediaBackfill({
  sb,
  sourceId,
  trigger = "manual",
  maxWallMs = DEFAULT_WALL_MS,
  fetcher,
  now = () => Date.now(),
}) {
  if (!sourceId) throw new Error("sourceId mangler");
  const startMs = now();

  const rows = await sb(
    `/media_sources?id=eq.${encodeURIComponent(sourceId)}` +
      `&select=id,name,domain,backfill_method,search_config,sitemap_url,sitemap_index,crawl_delay_ms,backfill_cursor`,
    { service: true },
  );
  const source = Array.isArray(rows) ? rows[0] : null;
  if (!source) throw new Error(`Fant ikke kilde ${sourceId}`);

  const [job] = await sb("/jobs", {
    service: true,
    method: "POST",
    body: {
      name: JOB_NAME,
      trigger,
      metadata: {
        source_id: sourceId,
        domain: source.domain,
        backfill_method: source.backfill_method,
      },
    },
    prefer: "return=representation",
  });

  try {
    // Leave 5s headroom for the queue insert + cursor PATCH at the end.
    const adapterBudget = Math.max(5_000, maxWallMs - 10_000);

    let urls;
    let stats;
    if (source.backfill_method === "rss_only") {
      // No manual backfill — rss_only sources rely on the daily
      // RSS-discover cron. Surface a friendly no-op instead of letting
      // the legacy site_search adapter throw "search_config mangler".
      throw new Error(
        "rss_only-kilden bruker daglig RSS-discover-cron — ingen manuell backfill",
      );
    } else if (source.backfill_method === "sitemap") {
      ({ urls, stats } = await walkSitemap({
        source,
        fetcher,
        maxWallMs: adapterBudget,
        now,
      }));
    } else if (source.backfill_method === "scrapegraph") {
      // Delegates to kiba-scraper sidecar; same {urls, stats} shape as
      // the legacy adapters.
      const queries = termsFromKeywords(await loadActiveMediaKeywords(sb));
      if (queries.length === 0) {
        throw new Error(
          "Ingen aktive keywords for media — sjekk /admin/keywords (domain=media|any)",
        );
      }
      const result = await scraperDiscoverUrls({
        queries,
        site: source.domain,
        // Cap per-query results so a single backfill tick stays bounded.
        // The kiba-scraper sidecar enforces a hard wall too.
        numResults: 10,
      });
      urls = result.urls;
      stats = {
        ...result.stats,
        adapter: "scrapegraph",
      };
    } else {
      // Legacy site_search path. Kept functional for Digi.no / Kode24
      // until they're flipped to scrapegraph.
      const queries = termsFromKeywords(await loadActiveMediaKeywords(sb));
      ({ urls, stats } = await searchSourceUrls({
        source,
        queries,
        fetcher,
        maxWallMs: adapterBudget,
        now,
      }));
    }

    let enqueued = 0;
    if (urls.length > 0) {
      enqueued = await batchEnqueue(sb, sourceId, urls);
    }

    // Advance cursor to today on success. "How far back have we reached"
    // is a soft metric for v1 — operator clicks until queue depth flattens.
    const today = new Date(now()).toISOString().slice(0, 10);
    await sb(`/media_sources?id=eq.${encodeURIComponent(sourceId)}`, {
      service: true,
      method: "PATCH",
      body: { backfill_cursor: today, updated_at: new Date(now()).toISOString() },
      prefer: "return=minimal",
    });

    const meta = {
      source_id: sourceId,
      domain: source.domain,
      backfill_method: source.backfill_method,
      urls_found: urls.length,
      enqueued,
      duration_ms: now() - startMs,
      ...stats,
    };
    await sb(`/jobs?id=eq.${job.id}`, {
      service: true,
      method: "PATCH",
      body: {
        finished_at: new Date(now()).toISOString(),
        status: "success",
        rows_processed: enqueued,
        metadata: meta,
      },
    });
    return { status: "success", job_id: job.id, ...meta };
  } catch (err) {
    await sb(`/jobs?id=eq.${job.id}`, {
      service: true,
      method: "PATCH",
      body: {
        finished_at: new Date(now()).toISOString(),
        status: "failed",
        error: String(err.message || err).slice(0, 1000),
      },
    });
    throw err;
  }
}

// Enqueue URLs in fixed-size batches with PostgREST `ignore-duplicates`.
// Returns the count of *newly inserted* rows (PostgREST's representation
// returns only the rows that didn't conflict). A re-run that finds
// everything already-queued returns 0.
async function batchEnqueue(sb, sourceId, urls) {
  let inserted = 0;
  // Pre-canonicalise + dedupe in-memory so we don't push 25 trivially
  // duplicate rows in one batch.
  const seen = new Set();
  const rows = [];
  for (const u of urls) {
    const canonical = canonicalizeUrl(u);
    if (!canonical) continue;
    const hash = urlHash(canonical);
    if (seen.has(hash)) continue;
    seen.add(hash);
    rows.push({
      source_id: sourceId,
      url: canonical,
      url_hash: hash,
      ingest_mode: "backfill",
    });
  }

  for (let i = 0; i < rows.length; i += ENQUEUE_BATCH) {
    const slice = rows.slice(i, i + ENQUEUE_BATCH);
    try {
      const result = await sb("/media_url_queue", {
        service: true,
        method: "POST",
        body: slice,
        prefer: "resolution=ignore-duplicates,return=representation",
      });
      inserted += Array.isArray(result) ? result.length : 0;
    } catch (err) {
      console.error("media-backfill: batch enqueue failed (non-fatal):", err.message);
    }
  }
  return inserted;
}

export const _internals = { batchEnqueue };
