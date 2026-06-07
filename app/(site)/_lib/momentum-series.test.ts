import { describe, expect, it } from "vitest";

import { jobsMomentumSeries, offentligYoYSeries } from "./momentum-series";

describe("jobsMomentumSeries", () => {
  const d = (date: string, ai: number) => ({ date, ai });

  it("computes window-over-window %-change (windowDays=1)", () => {
    const series = jobsMomentumSeries(
      [d("2026-01-01", 10), d("2026-01-02", 20), d("2026-01-03", 5)],
      1,
    );
    expect(series).toHaveLength(2);
    expect(series[0]).toBeCloseTo(100); // 10 → 20
    expect(series[1]).toBeCloseTo(-75); // 20 → 5
  });

  it("sorts by date first (does not trust input order)", () => {
    const series = jobsMomentumSeries(
      [d("2026-01-03", 5), d("2026-01-01", 10), d("2026-01-02", 20)],
      1,
    );
    expect(series[0]).toBeCloseTo(100);
    expect(series[1]).toBeCloseTo(-75);
  });

  it("skips points whose prior window is empty (no Infinity)", () => {
    const series = jobsMomentumSeries(
      [d("2026-01-01", 0), d("2026-01-02", 0), d("2026-01-03", 5)],
      1,
    );
    expect(series).toEqual([]);
  });

  it("respects the window length (needs 2*windowDays of history per point)", () => {
    const daily = Array.from({ length: 6 }, (_, i) =>
      d(`2026-01-0${i + 1}`, i + 1),
    );
    const series = jobsMomentumSeries(daily, 2); // points at i=3,4,5
    expect(series).toHaveLength(3);
    expect(series[0]).toBeCloseTo(((7 - 3) / 3) * 100); // (4+3) vs (2+1)
  });

  it("returns empty for a non-positive window", () => {
    expect(jobsMomentumSeries([d("2026-01-01", 1)], 0)).toEqual([]);
  });
});

describe("offentligYoYSeries", () => {
  it("needs 24 months of history before the first point", () => {
    expect(offentligYoYSeries(Array(12).fill(1))).toEqual([]);
    expect(offentligYoYSeries(Array(23).fill(1))).toEqual([]);
    expect(offentligYoYSeries(Array(24).fill(1))).toHaveLength(1);
  });

  it("computes 12mo-over-prior-12mo %-change", () => {
    // 24 flat months → 0 %; a 25th heavy month lifts the trailing 12mo sum.
    const monthly = [...Array(24).fill(1), 13];
    const series = offentligYoYSeries(monthly);
    expect(series).toHaveLength(2);
    expect(series[0]).toBeCloseTo(0); // first full year vs prior: flat
    // trailing 12 = months 13..24 = eleven 1s + 13 = 24; prior 12 = 12 → +100%
    expect(series[1]).toBeCloseTo(100);
  });
});
