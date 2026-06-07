// app/(site)/_lib/momentum-series.ts — per-pillar histories of signed
// %-change, used ONLY to scale the landing-page diverging gauges (fed to
// momentumSpans → robust p5/p95 edges). Pure + unit-tested.
//
// Oppstart doesn't need a builder here: its momentum history is already stored
// as brreg_snapshot_quarterly_ai_growth.yoy_growth_pct, so page.tsx feeds that
// array straight to momentumSpans.
//
// NOTE: both builders are index-based and assume contiguous daily / monthly
// rows (same assumption the old compute30dRollingSeries made). Gaps would
// shift a window; acceptable for an edge-scaling estimate.

/**
 * Jobs: a `windowDays`-over-`windowDays` %-change series from daily AI counts,
 * matching whichever window `buildJobsMomentum` currently reports (7 = WoW,
 * 30 = MoM). One sample per day that has two full prior windows behind it.
 * Skips points whose denominator window is empty (avoids ±Infinity).
 */
export function jobsMomentumSeries(
  daily: ReadonlyArray<{ date: string; ai: number }>,
  windowDays: number,
): number[] {
  if (windowDays <= 0) return [];
  const ai = [...daily]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => d.ai);
  const out: number[] = [];
  for (let i = 2 * windowDays - 1; i < ai.length; i++) {
    let cur = 0;
    let prev = 0;
    for (let k = 0; k < windowDays; k++) {
      cur += ai[i - k];
      prev += ai[i - windowDays - k];
    }
    if (prev > 0) out.push(((cur - prev) / prev) * 100);
  }
  return out;
}

/**
 * Offentlig: a 12-month-over-prior-12-month %-change series from monthly totals
 * (ascending), matching the headline's debate_yoy_pct. One sample per month
 * that has 24 full months of history behind it.
 */
export function offentligYoYSeries(monthlyAsc: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 23; i < monthlyAsc.length; i++) {
    let cur = 0;
    let prev = 0;
    for (let k = 0; k < 12; k++) {
      cur += monthlyAsc[i - k];
      prev += monthlyAsc[i - 12 - k];
    }
    if (prev > 0) out.push(((cur - prev) / prev) * 100);
  }
  return out;
}
