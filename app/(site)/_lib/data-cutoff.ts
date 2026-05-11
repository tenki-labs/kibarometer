// Data cutoff for /arbeidsmarked charts.
//
// NAV's public API only serves full posting detail (description) for ACTIVE
// ads. Once an ad goes INACTIVE, the detail endpoint either 404s or returns
// only {uuid, status, sistEndret} — no description. The keyword matcher
// needs description text to be reliable (title alone catches ~0.2% AI; full
// text catches ~2%).
//
// Because kibarometer started ingesting live data in early May 2026, almost
// every NAV posting predating that came in via backfillNav walking NAV's
// archive feed — every one of those was INACTIVE at ingest, so it never had
// a chance to be enriched. Result: pre-April-2026 rows are tagged on title
// alone and undercount AI by roughly 10x.
//
// Per-week description-coverage measured 2026-05-11:
//   2025-11 to 2026-04-06: 0.7 - 10.6%   (too unreliable to publish)
//   2026-04-13:            26.9%         (first usable week)
//   2026-04-20 onward:     46.3% - 57.4% (good)
//
// Choosing 2026-04-13 as the chart minimum: first week where coverage
// crosses 25%, which is the lowest threshold where we trust the
// classifier verdict to be representative of the underlying postings.
//
// This is a stopgap. Real fix: keep accumulating live data forward.
// Reassess this threshold quarterly — once we have a year of reliable
// data, we can drop the cutoff or push it later.
export const JOBBMARKED_DATA_CUTOFF = "2026-04-13";

// Earliest date at which snapshot_headline's ai_count_30d / ai_count_prev_30d
// comparison is honest. The prior-30-day window must end after the data
// cutoff for the comparison to be apples-to-apples — that means
// (today − 30 days) ≥ cutoff, i.e. today ≥ cutoff + 60 days = 2026-06-12.
//
// Until that date, the /arbeidsmarked hero shows a week-over-week pct
// (last 7d vs prior 7d, both fully post-cutoff) computed via
// buildJobsMomentum from snapshot_daily. On/after this date, it auto-
// flips to the 30/30 ratio from snapshot_headline. No code change
// required — the check is just (today >= JOBBMARKED_THIRTY_DAY_VALID_FROM).
export const JOBBMARKED_THIRTY_DAY_VALID_FROM = "2026-06-12";

export type JobsMomentum = {
  /** Percent change for the big number on the /arbeidsmarked hero and
   *  the landing-page Temperatur card. Built server-side via
   *  buildJobsMomentum so the week-over-week → 30/30 flip on
   *  JOBBMARKED_THIRTY_DAY_VALID_FROM happens once at request time
   *  with no client-side date logic. */
  pct: number | null;
  caption: string;
};

type HeadlineLike = {
  ai_count_30d: number;
  ai_count_prev_30d: number;
};

type DailyRowLike = {
  posted_on: string;
  ai_count: number;
};

// Single source of truth for the jobs pct-change number.
//
// Caller-side contract: snapshotDaily must already be filtered to
// posted_on >= JOBBMARKED_DATA_CUTOFF. We trust the caller's filter
// here (faster + reuses the same PostgREST roundtrip that already runs
// for the page's chart).
export function buildJobsMomentum(
  headline: HeadlineLike | null,
  snapshotDaily: readonly DailyRowLike[],
): JobsMomentum {
  const today = new Date().toISOString().slice(0, 10);
  if (today >= JOBBMARKED_THIRTY_DAY_VALID_FROM && headline) {
    const pct =
      headline.ai_count_prev_30d > 0
        ? ((headline.ai_count_30d - headline.ai_count_prev_30d) /
            headline.ai_count_prev_30d) *
          100
        : null;
    return { pct, caption: "siste 30 dager vs. foregående 30" };
  }
  // Anchor "now" to the latest posted_on we have, not wall clock — keeps
  // the window stable across 04:00 UTC snapshot rebuilds.
  let latest = 0;
  for (const row of snapshotDaily) {
    const t = new Date(row.posted_on + "T00:00:00Z").getTime();
    if (t > latest) latest = t;
  }
  if (latest === 0) {
    return { pct: null, caption: "siste 7 dager vs. foregående 7" };
  }
  const dayMs = 86_400_000;
  const sevenAgo = latest - 7 * dayMs;
  const fourteenAgo = latest - 14 * dayMs;
  let ai7 = 0;
  let aiPrev7 = 0;
  for (const row of snapshotDaily) {
    const t = new Date(row.posted_on + "T00:00:00Z").getTime();
    if (t > sevenAgo && t <= latest) ai7 += row.ai_count;
    else if (t > fourteenAgo && t <= sevenAgo) aiPrev7 += row.ai_count;
  }
  const pct = aiPrev7 > 0 ? ((ai7 - aiPrev7) / aiPrev7) * 100 : null;
  return { pct, caption: "siste 7 dager vs. foregående 7" };
}
