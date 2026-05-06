// lib/admin/legacy/fast-forward.js
//
// Fast-forward orchestrator for the BACKFILL button on /admin/processes.
// Walks NAV's stillingsfeed cursor WITHOUT ingesting (no nav_raw
// insert, no processPayload upsert). Used to skip past the 2023-06-14
// migration burst quickly — those events are NAV re-emitting historical
// postings we don't care about (pre-ChatGPT). Once last_event_at >=
// FF_THRESHOLD, the BACKFILL server action switches to backfillNav for
// full ingestion.
//
// Writes job rows with name='backfill_nav_stillingsfeed' and
// trigger='fast-forward' so backfillNav's prev-cursor lookup
// (jobs.js:186-189) inherits the cursor naturally when the action
// flips modes.

import { fetchStillingsfeedBatch } from "./nav-client.js";
import {
  BACKFILL_JOB,
  heartbeat,
  sweepStaleRunningJobs,
} from "./jobs.js";

// Threshold below which we don't ingest. NAV's feed launched 2023-06
// with a multi-day historical migration burst; postings created Jan-Dec
// 2023 are post-ChatGPT but per-product decision is to start at 2024.
export const FF_THRESHOLD = "2024-01-01T00:00:00Z";
const FF_THRESHOLD_MS = Date.parse(FF_THRESHOLD);

// NAV emits date_modified with `+02:00` offsets; lexicographic compare
// against an ISO Z string gives wrong results across timezones. Always
// compare via Date.parse so 2024-01-01T00:00:00+02:00 (= 2023-12-31
// 22:00 UTC) correctly sorts before 2024-01-01T00:00:00Z.
export function pastFFThreshold(lastEventAt) {
  if (!lastEventAt) return false;
  const ms = Date.parse(lastEventAt);
  return Number.isFinite(ms) && ms >= FF_THRESHOLD_MS;
}

// NAV's feed launched 2023-06-14. `drainProgressPct` maps a
// last_event_at into [0, 100] for the drain-coordinator banner on
// /admin/processes. Split into two zones so the bar is honest about which
// part of the work is meaningful:
//   - Fast-forward zone (2023-06-14 → 2024-01-01): we don't ingest
//     here, just walk the cursor. Mapped to 0–10% so a half-walked
//     burst doesn't show as 50% done.
//   - Catch-up zone (2024-01-01 → now): full ingestion. Mapped to
//     10–100%.
const FEED_START_MS = Date.parse("2023-06-14T00:00:00Z");
export function drainProgressPct(lastEventAt) {
  if (!lastEventAt) return 0;
  const ms = Date.parse(lastEventAt);
  if (!Number.isFinite(ms)) return 0;
  if (ms < FF_THRESHOLD_MS) {
    const span = FF_THRESHOLD_MS - FEED_START_MS;
    if (span <= 0) return 0;
    const pct = ((ms - FEED_START_MS) / span) * 10;
    return Math.max(0, Math.min(10, pct));
  }
  const nowMs = Date.now();
  const span = nowMs - FF_THRESHOLD_MS;
  if (span <= 0) return 100;
  const pct = 10 + ((ms - FF_THRESHOLD_MS) / span) * 90;
  return Math.max(10, Math.min(100, pct));
}

export async function fastForwardNav({ sb, trigger = "fast-forward" }) {
  await sweepStaleRunningJobs(sb).catch((e) =>
    console.error("sweepStaleRunningJobs failed (non-fatal):", e.message),
  );

  // Inherit cursor from latest successful predecessor — same lookup
  // shape as backfillNav so a fast-forward run picks up where a
  // catch-up run left off and vice versa.
  const prev = await sb(
    `/jobs?name=eq.${BACKFILL_JOB}&status=eq.success&order=started_at.desc&limit=1&select=metadata`,
    { service: true },
  );
  const prevMeta = prev[0]?.metadata || null;
  const startCursor =
    prevMeta?.next_cursor || prevMeta?.tail_cursor || null;

  const [job] = await sb(`/jobs`, {
    service: true,
    method: "POST",
    body: {
      name: BACKFILL_JOB,
      trigger,
      metadata: {
        start_cursor: startCursor,
        next_cursor: startCursor,
        completed: false,
      },
    },
    prefer: "return=representation",
  });
  await heartbeat(sb, job.id, { step: "starting fast-forward batch" });

  try {
    let pageNo = 0;
    const maxPages = 1000;
    // Heartbeat cadence: sweep threshold is 5 min (HEARTBEAT_STALE_MS in
    // jobs.js), 50 pages × ~150 ms = 7.5 s of work per heartbeat — well
    // within the safety margin and 20× cheaper than the per-page
    // heartbeat backfillNav uses.
    const HEARTBEAT_EVERY = 50;
    const summary = await fetchStillingsfeedBatch({
      cursor: startCursor,
      maxPages,
      maxWallMs: 200_000,
      onPage: async () => {
        // No-op: skip nav_raw insert, skip processPayload. Cursor walk
        // happens inside fetchStillingsfeedBatch regardless.
        pageNo += 1;
        if (pageNo % HEARTBEAT_EVERY === 0) {
          await heartbeat(sb, job.id, {
            pct: (pageNo / maxPages) * 100,
            step: `walked page ${pageNo} / ${maxPages} (no-op)`,
          });
        }
      },
    });

    const thresholdReached = pastFFThreshold(summary.lastEventAt);

    // Mirror backfillNav's metadata shape so its prev lookup picks the
    // right cursor when the BACKFILL action transitions to ingestion.
    const newMeta = summary.completed
      ? {
          start_cursor: startCursor,
          next_cursor: null,
          tail_cursor: summary.lastPageId,
          completed: true,
          pages_fetched: summary.pagesFetched,
          last_event_at: summary.lastEventAt,
          fast_forward: true,
        }
      : {
          start_cursor: startCursor,
          next_cursor: summary.nextCursor,
          tail_cursor: null,
          completed: false,
          pages_fetched: summary.pagesFetched,
          last_event_at: summary.lastEventAt,
          fast_forward: true,
        };

    await sb(`/jobs?id=eq.${job.id}`, {
      service: true,
      method: "PATCH",
      body: {
        finished_at: new Date().toISOString(),
        status: "success",
        rows_processed: 0,
        metadata: newMeta,
      },
    });

    return {
      id: job.id,
      status: "success",
      pages: summary.pagesFetched,
      next_cursor: summary.nextCursor,
      last_event_at: summary.lastEventAt,
      completed: summary.completed,
      threshold_reached: thresholdReached,
    };
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
