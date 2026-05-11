// lib/admin/legacy/media-fetch-classify.js
// Drains media_url_queue → media_articles. The cheap part of the cascade:
// no LLM here, just fetch + extract + keyword match + simhash + wire-
// cluster probe + persist. The article body lives in memory only during
// this function and is GC'd once the row is written. NO body / content /
// text column on media_articles by design.
//
// Per-tick budget: K candidates, MAX_WALL_MS wall clock, whichever first.
// Wire-cluster matching: for each new article with a published_at, query
// for media_articles within ±24h with non-null simhash, pick the first
// candidate within NTB_THRESHOLD bits of Hamming distance. If the match
// already has a wire_cluster_id we adopt it; otherwise we mint a new
// cluster anchored on the matched article and back-link both.

import { fetchHtml } from "./media-client.js";
import { extractArticle } from "./media-extract.js";
import {
  buildArticleRow,
  compileMatchers,
  loadActiveMediaKeywords,
} from "./media-processor.js";
import { hamming } from "./media-simhash.js";

const JOB_NAME = "media_fetch_classify";
const DEFAULT_K = 20;
const DEFAULT_WALL_MS = 60_000;

const WIRE_WINDOW_MS = 24 * 60 * 60 * 1000;
const WIRE_CANDIDATE_LIMIT = 200;

// NTB / wire de-dup threshold. Matches media-simhash.js's isSimilar default;
// see that file's comment for why 8 bits (not 3 as the PRD speculated) is
// the realistic threshold for headline+300-char inputs with our char-4gram
// augmented tokenizer.
const NTB_THRESHOLD = 8;

/**
 * @param {object} args
 * @param {(path: string, init?: any) => Promise<any>} args.sb
 * @param {"manual" | "cron"} [args.trigger]
 * @param {number} [args.k]
 * @param {number} [args.maxWallMs]
 * @param {Function} [args.fetcher]
 * @param {() => number} [args.now]
 */
export async function runFetchClassify({
  sb,
  trigger = "manual",
  k = DEFAULT_K,
  maxWallMs = DEFAULT_WALL_MS,
  fetcher,
  now = () => Date.now(),
}) {
  const startMs = now();

  // Drain 'live' rows before 'backfill' rows so a multi-thousand-URL
  // sitemap dump for a historical 2020-onwards backfill can't starve
  // today's fresh discoveries in the queue. PostgREST text collation
  // sorts 'backfill' < 'live' alphabetically, so DESC lands 'live'
  // first; within each tier we drain oldest-first (FIFO). Index
  // support added in migration 0062.
  const candidates = await sb(
    `/media_url_queue?status=eq.pending` +
      `&order=ingest_mode.desc,discovered_at.asc&limit=${k}` +
      "&select=id,url,source_id,attempts,ingest_mode," +
      "source:media_sources(id,domain,crawl_delay_ms,extractor_config)",
    { service: true },
  );

  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { status: "noop", reason: "queue_empty", processed: 0 };
  }

  const matchers = compileMatchers(await loadActiveMediaKeywords(sb));
  const [job] = await sb("/jobs", {
    service: true,
    method: "POST",
    body: {
      name: JOB_NAME,
      trigger,
      metadata: { candidates: candidates.length },
    },
    prefer: "return=representation",
  });

  let fetched = 0;
  let inserted = 0;
  let aiCount = 0;
  let clustered = 0;
  let robotsBlocked = 0;
  let extractFails = 0;
  let httpFails = 0;
  let stopped = "k_reached";

  try {
    for (let idx = 0; idx < candidates.length; idx += 1) {
      if (now() - startMs > maxWallMs) {
        stopped = "wall_time";
        break;
      }
      const c = candidates[idx];
      const crawlDelay = c.source?.crawl_delay_ms || undefined;

      let res;
      try {
        res = await fetchHtml(c.url, {
          crawlDelayMs: crawlDelay,
          ...(fetcher ? { fetcher } : {}),
        });
      } catch (err) {
        await markQueueFailed(sb, c, `fetch_threw:${(err && err.message) || err}`);
        httpFails += 1;
        continue;
      }

      if (!res.ok) {
        if (res.disallowed) {
          await markQueueFailed(sb, c, "robots_disallow");
          robotsBlocked += 1;
        } else {
          await markQueueFailed(sb, c, `http_${res.status || "net"}`);
          httpFails += 1;
        }
        continue;
      }
      fetched += 1;

      const extracted = extractArticle(res.body);
      if (extracted.extraction_strategy_used === "extract_failed") {
        extractFails += 1;
      }

      const row = buildArticleRow({
        url: c.url,
        sourceId: c.source_id,
        extracted,
        matchers,
        ingestMode: c.ingest_mode,
      });

      // Wire-cluster match only when both published_at and simhash are
      // present. Articles with no published_at don't appear in the
      // snapshot pipeline (see refresh_media_snapshot_daily) so clustering
      // them buys nothing.
      let clusterId = null;
      if (extracted.published_at && row.simhash) {
        try {
          clusterId = await assignWireCluster(sb, row);
        } catch (err) {
          // Don't fail the whole tick on a cluster lookup glitch — write
          // the article without a cluster and let the next pass catch it.
          console.error("assignWireCluster failed (non-fatal):", err.message);
        }
        if (clusterId) clustered += 1;
      }
      row.wire_cluster_id = clusterId;

      // Idempotent insert. ignore-duplicates: a re-discovered URL with the
      // same hash silently no-ops rather than 409ing the whole batch.
      try {
        const result = await sb("/media_articles", {
          service: true,
          method: "POST",
          body: row,
          prefer: "resolution=ignore-duplicates,return=representation",
        });
        if (Array.isArray(result) && result.length > 0) {
          inserted += 1;
          if (row.is_ai_related) aiCount += 1;
        }
        await sb(`/media_url_queue?id=eq.${encodeURIComponent(c.id)}`, {
          service: true,
          method: "PATCH",
          body: { status: "fetched", attempts: (c.attempts || 0) + 1 },
          prefer: "return=minimal",
        });
      } catch (err) {
        await markQueueFailed(sb, c, `insert_failed:${(err && err.message) || err}`);
      }
    }

    const meta = {
      candidates: candidates.length,
      fetched,
      inserted,
      ai_count: aiCount,
      clustered,
      robots_blocked: robotsBlocked,
      extract_fails: extractFails,
      http_fails: httpFails,
      stopped,
    };
    await sb(`/jobs?id=eq.${job.id}`, {
      service: true,
      method: "PATCH",
      body: {
        finished_at: new Date().toISOString(),
        status: "success",
        rows_processed: inserted,
        metadata: meta,
      },
    });
    return { status: "success", job_id: job.id, ...meta };
  } catch (err) {
    await sb(`/jobs?id=eq.${job.id}`, {
      service: true,
      method: "PATCH",
      body: {
        finished_at: new Date().toISOString(),
        status: "failed",
        error: String(err.message || err).slice(0, 1000),
      },
    });
    throw err;
  }
}

async function markQueueFailed(sb, c, error) {
  await sb(`/media_url_queue?id=eq.${encodeURIComponent(c.id)}`, {
    service: true,
    method: "PATCH",
    body: {
      status: "failed",
      attempts: (c.attempts || 0) + 1,
      last_error: String(error).slice(0, 500),
    },
    prefer: "return=minimal",
  });
}

// Wire-cluster matcher. Returns the wire_cluster_id the new article should
// adopt, or null if no candidate within ±24h passes the Hamming threshold.
//
// PostgREST returns bigint as a JSON number, which loses precision above
// 2^53. We cast simhash → text in the response so the round-trip is exact.
export async function assignWireCluster(sb, row) {
  const pubDate = new Date(row.published_at);
  if (Number.isNaN(pubDate.getTime())) return null;
  const start = new Date(pubDate.getTime() - WIRE_WINDOW_MS).toISOString();
  const end = new Date(pubDate.getTime() + WIRE_WINDOW_MS).toISOString();

  const candidates = await sb(
    `/media_articles?published_at=gte.${encodeURIComponent(start)}` +
      `&published_at=lte.${encodeURIComponent(end)}` +
      "&simhash=not.is.null&deleted_at=is.null" +
      "&select=id,wire_cluster_id,simhash_text:simhash::text" +
      `&limit=${WIRE_CANDIDATE_LIMIT}`,
    { service: true },
  );

  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const ours = BigInt(row.simhash);
  let best = null;
  let bestDist = NTB_THRESHOLD + 1;
  for (const c of candidates) {
    if (!c.simhash_text) continue;
    let theirs;
    try {
      theirs = BigInt(c.simhash_text);
    } catch {
      continue;
    }
    const d = hamming(ours, theirs);
    if (d < bestDist) {
      bestDist = d;
      best = c;
      if (d === 0) break;
    }
  }
  if (!best || bestDist > NTB_THRESHOLD) return null;

  // Adopt existing cluster if the matched article already has one.
  if (best.wire_cluster_id) return best.wire_cluster_id;

  // Otherwise mint a new cluster anchored on the matched article and
  // back-link it. cluster_size starts at 2 (matched + new); subsequent
  // adopters don't increment (the count can be recomputed on demand from
  // count(*) where wire_cluster_id = X — soft metric).
  const created = await sb("/media_wire_clusters", {
    service: true,
    method: "POST",
    body: {
      representative_article_id: best.id,
      cluster_size: 2,
    },
    prefer: "return=representation",
  });
  const cluster = Array.isArray(created) ? created[0] : created;
  if (!cluster?.id) return null;

  await sb(`/media_articles?id=eq.${encodeURIComponent(best.id)}`, {
    service: true,
    method: "PATCH",
    body: { wire_cluster_id: cluster.id },
    prefer: "return=minimal",
  });
  return cluster.id;
}

export const _internals = { assignWireCluster };
