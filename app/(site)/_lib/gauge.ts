// app/(site)/_lib/gauge.ts — shared gauge math for the landing-page
// Temperatur cards. Kept framework-free and pure so the card models can be
// unit-tested without rendering the server component.

export type GaugeData = {
  value: number;
  min: number;
  max: number;
  p10: number;
  p50: number;
  p90: number;
};

/** Linear-interpolated percentile of an ascending-sorted array. */
export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const idx = (sortedAsc.length - 1) * (p / 100);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

/**
 * Horizontal position (0..100) of `value` on the gauge bar, by **percentile
 * rank** rather than a linear min→max sweep. Anchored on the distribution's
 * own quantiles:
 *
 *   min → 0%   p10 → 10%   p50 → 50%   p90 → 90%   max → 100%
 *
 * with linear interpolation between adjacent anchors. Two reasons this beats
 * the old `((value-min)/(max-min))*100`:
 *
 *  1. The median lands dead-center, so the gradient's neutral-grey midpoint
 *     actually means "typical". A linear scale drags the median toward the
 *     left/right on any skewed distribution, leaving the bulk of the bar
 *     empty and a normal reading looking pegged "hot".
 *  2. The marker stays in agreement with the høyt/over-snitt/under-snitt/lavt
 *     level label, which is itself percentile-based — a linear marker drifts
 *     off the label and reads as self-contradictory.
 *
 * Values outside the recorded [min,max] clamp to the edges; a flat
 * distribution (max == min) returns the neutral midpoint.
 */
export function gaugePositionPct(
  value: number,
  bounds: Pick<GaugeData, "min" | "max" | "p10" | "p50" | "p90">,
): number {
  const { min, max, p10, p50, p90 } = bounds;
  if (max <= min) return 50;
  if (value <= min) return 0;
  if (value >= max) return 100;

  // (value, percent) anchors — ascending in value by quantile definition.
  const anchors: ReadonlyArray<readonly [number, number]> = [
    [min, 0],
    [p10, 10],
    [p50, 50],
    [p90, 90],
    [max, 100],
  ];
  for (let i = 0; i < anchors.length - 1; i++) {
    const [av, ap] = anchors[i];
    const [bv, bp] = anchors[i + 1];
    if (value <= bv) {
      if (bv <= av) return bp; // degenerate segment — snap to the upper anchor
      const t = (value - av) / (bv - av);
      return ap + t * (bp - ap);
    }
  }
  return 100;
}
