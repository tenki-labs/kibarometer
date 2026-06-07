// app/(site)/_lib/gauge.ts — shared gauge math for the landing-page Temperatur
// cards. Kept framework-free and pure so the card models can be unit-tested
// without rendering the server component.
//
// The bar is a DIVERGING gauge: a neutral midpoint sits at the center (grey),
// and the value diverges left (cold) / right (warm) from it. For the momentum
// cards the neutral is 0 % change; for the media index it is 50. This makes the
// bar's direction agree with the headline's sign (↑ positive → warm/right,
// ↓ negative → cold/left), which the old absolute-level percentile gauge did
// not.

/** Linear-interpolated percentile of an ascending-sorted array. */
export function percentile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const idx = (sortedAsc.length - 1) * (p / 100);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

/**
 * Marker position (0..100 % of the bar) for a signed momentum value, with 0
 * pinned at the **center** (50 %). The right half spans `[0, posSpan]`, the
 * left half spans `[-negSpan, 0]` — asymmetric per side because growth is
 * unbounded while decline floors at −100 %. Values past a span clamp to the
 * edge. `negSpan`/`posSpan` are positive magnitudes (see `momentumSpans`).
 */
export function divergingMomentumPct(
  pct: number,
  negSpan: number,
  posSpan: number,
): number {
  if (pct >= 0) {
    const span = posSpan > 0 ? posSpan : 1;
    return 50 + Math.min(1, pct / span) * 50;
  }
  const span = negSpan > 0 ? negSpan : 1;
  return 50 - Math.min(1, -pct / span) * 50;
}

/**
 * Generic diverging map around an explicit `neutral` with a symmetric
 * `halfRange` (value at `neutral ± halfRange` → bar edge). Used by the media
 * card: `divergingPct(index, 50, 50)` makes index 50 the center, 0 the cold
 * edge and 100 the warm edge. A non-positive halfRange returns the midpoint.
 */
export function divergingPct(
  value: number,
  neutral: number,
  halfRange: number,
): number {
  if (halfRange <= 0) return 50;
  const t = (value - neutral) / halfRange;
  return 50 + Math.max(-1, Math.min(1, t)) * 50;
}

// A pillar needs at least this many momentum samples before its own history is
// trusted to set the gauge edges; below it we fall back to a symmetric ±100 %.
export const MIN_MOMENTUM_POINTS = 8;
export const DEFAULT_MOMENTUM_SPAN = 100;

/**
 * Robust per-side edges for a pillar's momentum gauge, from its history of
 * signed %-changes. The right edge is the p95 of the positive swings, the left
 * edge the |p5| of the negative swings — robust so a single freak week-over-
 * week spike (common with small early denominators) doesn't set the edge and
 * squash every normal reading to the center. Falls back to ±DEFAULT span when a
 * side has no samples or the series is too short to trust.
 */
export function momentumSpans(series: readonly number[]): {
  negSpan: number;
  posSpan: number;
} {
  const finite = series.filter((x) => Number.isFinite(x));
  if (finite.length < MIN_MOMENTUM_POINTS) {
    return { negSpan: DEFAULT_MOMENTUM_SPAN, posSpan: DEFAULT_MOMENTUM_SPAN };
  }
  const sorted = [...finite].sort((a, b) => a - b);
  const low = percentile(sorted, 5); // typically ≤ 0
  const high = percentile(sorted, 95); // typically ≥ 0
  return {
    negSpan: low < 0 ? -low : DEFAULT_MOMENTUM_SPAN,
    posSpan: high > 0 ? high : DEFAULT_MOMENTUM_SPAN,
  };
}
