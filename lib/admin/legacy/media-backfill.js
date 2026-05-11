// lib/admin/legacy/media-backfill.js
// Per-source backfill orchestrator. Manual trigger only (no cron) — the
// admin UI's "Backfill" button on /admin/media/sources fires this.
//
// One tick = one wall-time-bounded run. The dispatcher routes on the
// source's `backfill_method`:
//
//   - 'scrapegraph' (default) — delegates to the kiba-scraper sidecar.
//     /discover wraps a direct ddgs.DDGS().text() call across multiple
//     search engines (no LLM in the loop since PR #143). Used for
//     forward steady-state discovery on outlets without a usable
//     sitemap.
//
//   - 'sitemap' — walks the source's sitemap.xml (and sitemap-index
//     children) via walkSitemap, optionally filtered by <lastmod>
//     >= `since`. This is how we reach 2020-onwards archive — DDG's
//     index doesn't go back that far reliably. Selected on a per-source
//     basis by the operator via /admin/media/sources/[id]/edit.
//
// In all cases new URLs are enqueued into media_url_queue (idempotent
// on url_hash). `backfill_cursor` is advanced to today on success — a
// soft "how recently did we run a backfill tick" metric.

import {
  canonicalizeUrl,
  loadActiveMediaKeywords,
  urlHash,
} from "./media-processor.js";
import { discoverUrls as scraperDiscoverUrls } from "./media-scraper-client.js";
import { walkSitemap } from "./media-sitemap.js";

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
 * @param {Date|string} [args.since]  Only relevant for the sitemap adapter.
 *   Caps how far back `<lastmod>` filtering allows entries. Ignored by
 *   scrapegraph since DDG can't reliably filter by date.
 * @param {Function} [args.fetcher]   Optional fetcher injection for sitemap
 *   tests.
 * @param {() => number} [args.now]
 */
export async function runMediaBackfill({
  sb,
  sourceId,
  trigger = "manual",
  maxWallMs = DEFAULT_WALL_MS,
  since,
  fetcher,
  now = () => Date.now(),
}) {
  if (!sourceId) throw new Error("sourceId mangler");
  const startMs = now();

  const rows = await sb(
    `/media_sources?id=eq.${encodeURIComponent(sourceId)}` +
      `&select=id,name,domain,backfill_method,sitemap_url,sitemap_index,` +
      `crawl_delay_ms,backfill_cursor`,
    { service: true },
  );
  const source = Array.isArray(rows) ? rows[0] : null;
  if (!source) throw new Error(`Fant ikke kilde ${sourceId}`);

  const method = source.backfill_method || "scrapegraph";

  const [job] = await sb("/jobs", {
    service: true,
    method: "POST",
    body: {
      name: JOB_NAME,
      trigger,
      metadata: {
        source_id: sourceId,
        domain: source.domain,
        adapter: method,
        since: since ? new Date(since).toISOString().slice(0, 10) : null,
      },
    },
    prefer: "return=representation",
  });

  try {
    // Leave 5 s headroom for the queue insert + cursor PATCH at the end
    // of the tick. The sitemap adapter respects this; scrapegraph has
    // its own internal wall budget enforced by the sidecar.
    const adapterBudget = Math.max(5_000, maxWallMs - 10_000);

    let urls;
    let stats;
    if (method === "sitemap") {
      ({ urls, stats } = await runSitemap({
        source, since, fetcher, adapterBudget, now,
      }));
    } else {
      // scrapegraph (default) — ignores `since` because DDG can't
      // filter by date reliably. Use the sitemap adapter for historical
      // backfill.
      ({ urls, stats } = await runScrapegraph({ sb, source }));
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
      adapter: method,
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

async function runScrapegraph({ sb, source }) {
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
  return {
    urls: result.urls,
    stats: { ...result.stats, adapter: "scrapegraph" },
  };
}

async function runSitemap({ source, since, fetcher, adapterBudget, now }) {
  if (!source.sitemap_url) {
    throw new Error(
      "sitemap_url mangler — sett det på /admin/media/sources/<id>/edit før du kjører sitemap-backfill",
    );
  }
  const { urls, stats } = await walkSitemap({
    source,
    since,
    fetcher,
    maxWallMs: adapterBudget,
    now,
  });
  return { urls, stats: { ...stats, adapter: "sitemap" } };
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
