import { describe, expect, it } from "vitest";

import {
  divergingMomentumPct,
  divergingPct,
  momentumSpans,
  momentumGauge,
  trendDescriptor,
  mediaTone,
  percentile,
  DEFAULT_MOMENTUM_SPAN,
} from "./gauge";

describe("divergingMomentumPct (momentum cards: 0 = center)", () => {
  it("puts 0 % change at the center", () => {
    expect(divergingMomentumPct(0, 50, 80)).toBe(50);
  });

  it("a positive swing goes RIGHT (warm); reaching posSpan hits the right edge", () => {
    expect(divergingMomentumPct(80, 50, 80)).toBe(100);
    expect(divergingMomentumPct(40, 50, 80)).toBe(75); // halfway up the right
    expect(divergingMomentumPct(40, 50, 80)).toBeGreaterThan(50);
  });

  it("a negative swing goes LEFT (cold); reaching negSpan hits the left edge", () => {
    expect(divergingMomentumPct(-50, 50, 80)).toBe(0);
    expect(divergingMomentumPct(-25, 50, 80)).toBe(25);
    expect(divergingMomentumPct(-25, 50, 80)).toBeLessThan(50);
  });

  it("is the regression fix: −91 % is cold, +85 % is warm (with asymmetric spans)", () => {
    // Arbeidsmarked-like: big decline → left; Oppstart-like: big rise → right.
    expect(divergingMomentumPct(-91, 91, 200)).toBeLessThan(50);
    expect(divergingMomentumPct(85, 91, 200)).toBeGreaterThan(50);
  });

  it("clamps swings past the historical span to the edge", () => {
    expect(divergingMomentumPct(500, 50, 80)).toBe(100);
    expect(divergingMomentumPct(-500, 50, 80)).toBe(0);
  });

  it("guards a zero/absent span without NaN", () => {
    expect(Number.isFinite(divergingMomentumPct(10, 0, 0))).toBe(true);
    expect(divergingMomentumPct(0, 0, 0)).toBe(50);
  });
});

describe("divergingPct (media index: 50 = center)", () => {
  it("maps the index onto the bar with the neutral waterline centered", () => {
    expect(divergingPct(50, 50, 50)).toBe(50); // neutral → center
    expect(divergingPct(0, 50, 50)).toBe(0); // fully cold → left edge
    expect(divergingPct(100, 50, 50)).toBe(100); // fully warm → right edge
    expect(divergingPct(70, 50, 50)).toBe(70); // identity for [0,100] index
  });

  it("clamps out-of-range values and guards a zero half-range", () => {
    expect(divergingPct(120, 50, 50)).toBe(100);
    expect(divergingPct(-20, 50, 50)).toBe(0);
    expect(divergingPct(42, 50, 0)).toBe(50);
  });
});

describe("momentumSpans (robust per-side edges)", () => {
  it("uses robust p5/p95, not raw min/max, so one freak swing can't dominate", () => {
    // 38 calm readings (−18..+19) + one +900% spike. With 39 points p95 lands
    // inside the calm range, so the lone outlier doesn't set the edge.
    const calm = Array.from({ length: 38 }, (_, i) => i - 18);
    const { posSpan } = momentumSpans([...calm, 900]);
    expect(posSpan).toBeLessThan(25); // ~18, NOT pinned to the 900 outlier
    expect(posSpan).toBeGreaterThan(0);
  });

  it("derives both spans from a two-sided history", () => {
    const series = [-40, -30, -20, -10, 0, 10, 20, 30, 40, 50];
    const { negSpan, posSpan } = momentumSpans(series);
    expect(negSpan).toBeGreaterThan(0);
    expect(posSpan).toBeGreaterThan(0);
    expect(posSpan).toBeCloseTo(percentile([...series].sort((a, b) => a - b), 95));
  });

  it("falls back to the symmetric default below the minimum sample count", () => {
    expect(momentumSpans([5, -3, 8])).toEqual({
      negSpan: DEFAULT_MOMENTUM_SPAN,
      posSpan: DEFAULT_MOMENTUM_SPAN,
    });
  });

  it("falls back on a one-sided history (no opposite-sign samples)", () => {
    const allPositive = [5, 10, 15, 20, 25, 30, 35, 40, 45]; // 9 pts, all > 0
    const { negSpan, posSpan } = momentumSpans(allPositive);
    expect(negSpan).toBe(DEFAULT_MOMENTUM_SPAN); // no negative side observed
    expect(posSpan).toBeGreaterThan(0);
    expect(posSpan).toBeLessThan(DEFAULT_MOMENTUM_SPAN);
  });
});

describe("momentumGauge", () => {
  const flat: number[] = []; // forces the ±DEFAULT span fallback

  it("returns null on a null pct (no bar)", () => {
    expect(momentumGauge(null, flat)).toBeNull();
  });

  it("returns null on a NON-FINITE pct — mirrors the '—' headline (regression #1)", () => {
    expect(momentumGauge(NaN, flat)).toBeNull();
    expect(momentumGauge(Infinity, flat)).toBeNull();
    expect(momentumGauge(-Infinity, flat)).toBeNull();
  });

  it("renders a marker on the correct side for a finite pct", () => {
    expect(momentumGauge(40, flat)!.markerPct).toBeGreaterThan(50); // warm
    expect(momentumGauge(-40, flat)!.markerPct).toBeLessThan(50); // cold
    expect(momentumGauge(0, flat)!.markerPct).toBe(50); // center
  });
});

describe("trendDescriptor (word matches the headline arrow + marker)", () => {
  it("treats |pct| < 1 as stabilt, matching fmtMomentumPct's '≈ 0 %'", () => {
    expect(trendDescriptor(0)).toBe("stabilt");
    expect(trendDescriptor(0.9)).toBe("stabilt");
    expect(trendDescriptor(-0.9)).toBe("stabilt");
  });

  it("calls a 1–2 % move stigende/fallende, not stabilt (regression #2)", () => {
    // Old code's |pct|<2 deadzone said "stabilt" while the headline showed
    // "↑ +1,5 %" and the marker sat right-of-center — a 3-way contradiction.
    expect(trendDescriptor(1.5)).toBe("stigende");
    expect(trendDescriptor(-1.5)).toBe("fallende");
    expect(trendDescriptor(85)).toBe("stigende");
    expect(trendDescriptor(-91)).toBe("fallende");
  });

  it("returns ukjent for null / non-finite", () => {
    expect(trendDescriptor(null)).toBe("ukjent");
    expect(trendDescriptor(NaN)).toBe("ukjent");
  });
});

describe("mediaTone (word agrees with which side of center the marker sits)", () => {
  it("flips at the neutral center (50), not a 45–55 dead-band (regression #2)", () => {
    // index 54 → markerPct 54 (right of center); the word must agree.
    expect(mediaTone(54)).toBe("optimistisk tone");
    expect(mediaTone(46)).toBe("kritisk tone");
    expect(mediaTone(51)).toBe("optimistisk tone");
    expect(mediaTone(49)).toBe("kritisk tone");
  });

  it("is neutral only at the exact waterline", () => {
    expect(mediaTone(50)).toBe("nøytral tone");
  });
});
