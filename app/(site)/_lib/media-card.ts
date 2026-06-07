// app/(site)/_lib/media-card.ts — decides what the landing-page Mediedekning
// card should show, given the trailing media_snapshot_index history.
//
// Why this exists: refresh_media_snapshot_index emits a no-signal SENTINEL
// of index_value=50 (= round(50 + 50*coalesce(mean_temp, 0))) for any day
// whose trailing-7d window has zero tier2-completed AI articles. When the
// media classification pipeline stalls, every recent day becomes that
// sentinel, and the raw card would render "50 / 100 · 0 ai-artikler siste 7
// dager" — a self-contradictory, hard-coded-looking reading. We treat a
// sentinel latest-day as "no fresh coverage" (→ Empty card).
//
// The media index is already a DIVERGING value around 50 (index = 50 +
// 50*mean_temp, mean_temp ∈ [−1, 1]): 0 = fully cold/critical, 50 = neutral
// waterline, 100 = fully warm/enthusiastic. So the gauge marker is just the
// index mapped onto the bar with 50 at the center.
//
// See supabase/migrations/0066_media_snapshot_floor.sql for the index math.

import { divergingPct } from "./gauge";

export type MediaIndexRow = {
  date: string; // YYYY-MM-DD
  index_value: number; // 0..100
  ai_article_count_7d: number;
};

export type MediaCardModel = {
  indexValue: number;
  aiArticleCount7d: number;
  /** Marker position (0..100 % of the bar); 50 = neutral waterline. */
  markerPct: number;
};

// Need at least this many real-signal days before we publish a reading —
// guards against rendering off a near-empty / just-restarted pipeline.
const MIN_SIGNAL_DAYS = 5;

// Media index neutral midpoint + half-range: 50 is the waterline, ±50 reaches
// the cold (0) / warm (100) edges.
const MEDIA_NEUTRAL = 50;
const MEDIA_HALF_RANGE = 50;

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

  // Require a few real-signal days so we don't publish off a just-restarted
  // pipeline.
  const signalDays = rows.filter((r) => r.ai_article_count_7d > 0).length;
  if (signalDays < MIN_SIGNAL_DAYS) return null;

  return {
    indexValue: latest.index_value,
    aiArticleCount7d: latest.ai_article_count_7d,
    markerPct: divergingPct(latest.index_value, MEDIA_NEUTRAL, MEDIA_HALF_RANGE),
  };
}
