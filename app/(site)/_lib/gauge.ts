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
