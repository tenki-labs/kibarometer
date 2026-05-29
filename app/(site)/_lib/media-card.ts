// app/(site)/_lib/media-card.ts — decides what the landing-page Mediedekning
// card should show, given the trailing media_snapshot_index history.
//
// Why this exists: refresh_media_snapshot_index emits a no-signal SENTINEL
// of index_value=50 (= round(50 + 50*coalesce(mean_temp, 0))) for any day
// whose trailing-7d window has zero tier2-completed AI articles. When the
// media classification pipeline stalls, every recent day becomes that
// sentinel, and the raw card would render "50 / 100 · over snitt · 0
// ai-artikler siste 7 dager" — a self-contradictory, hard-coded-looking
// reading. We treat a sentinel latest-day as "no fresh coverage" (→ Empty
// card) and exclude sentinel days from the percentile distribution so the
// level label reflects real readings only.
//
// See supabase/migrations/0066_media_snapshot_floor.sql for the index math.

import { percentile, type GaugeData } from "./gauge";

export type MediaIndexRow = {
  date: string; // YYYY-MM-DD
  index_value: number; // 0..100
  ai_article_count_7d: number;
};

export type MediaCardModel = {
  indexValue: number;
  aiArticleCount7d: number;
  gauge: GaugeData;
};

// Need at least this many real-signal days before the percentile band is
// meaningful. Matches the >= 5 guard the other landing-page gauges use.
const MIN_DISTRIBUTION_DAYS = 5;

/**
 * Build the Mediedekning card model, or `null` when the data isn't
 * trustworthy enough to publish a reading (→ caller renders the Empty card).
 */
export function buildMediaCardModel(
  rows: readonly MediaIndexRow[],
): MediaCardModel | null {
  if (rows.length === 0) return null;

  // Latest by date — don't assume the caller pre-sorted.
  const latest = rows.reduce((a, b) => (b.date > a.date ? b : a));

  // No-signal sentinel: the most recent reading carries no AI articles, so
  // index_value is the neutral 50 fallback, not a real measurement.
  if (latest.ai_article_count_7d <= 0) return null;

  // Percentile band from real-signal days only; sentinel 50s would pin every
  // percentile toward the midpoint and mislabel the level.
  const signal = rows.filter((r) => r.ai_article_count_7d > 0);
  if (signal.length < MIN_DISTRIBUTION_DAYS) return null;

  const sorted = signal.map((r) => r.index_value).sort((a, b) => a - b);
  return {
    indexValue: latest.index_value,
    aiArticleCount7d: latest.ai_article_count_7d,
    gauge: {
      value: latest.index_value,
      min: 0,
      max: 100,
      p10: percentile(sorted, 10),
      p50: percentile(sorted, 50),
      p90: percentile(sorted, 90),
    },
  };
}
