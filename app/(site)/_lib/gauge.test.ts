import { describe, expect, it } from "vitest";

import { gaugePositionPct, type GaugeData } from "./gauge";

// Bounds-only slice of GaugeData (the position math ignores `value`).
type Bounds = Pick<GaugeData, "min" | "max" | "p10" | "p50" | "p90">;

describe("gaugePositionPct", () => {
  it("maps each quantile anchor to its fixed bar position", () => {
    const g: Bounds = { min: 10, max: 460, p10: 120, p50: 250, p90: 400 };
    expect(gaugePositionPct(10, g)).toBe(0); // record low → left edge
    expect(gaugePositionPct(120, g)).toBeCloseTo(10);
    expect(gaugePositionPct(250, g)).toBeCloseTo(50); // median → dead center
    expect(gaugePositionPct(400, g)).toBeCloseTo(90);
    expect(gaugePositionPct(460, g)).toBe(100); // record high → right edge
  });

  it("keeps the median centered on a right-skewed distribution", () => {
    // A far-outlier max drags the OLD linear min→max scale so the median
    // lands near the left edge (~2%). Percentile anchoring fixes it to 50%.
    const g: Bounds = { min: 0, max: 1000, p10: 5, p50: 20, p90: 60 };
    const oldLinear = ((20 - 0) / (1000 - 0)) * 100;
    expect(oldLinear).toBeCloseTo(2); // documents the bug we're removing
    expect(gaugePositionPct(20, g)).toBeCloseTo(50);
  });

  it("agrees with the level label: an 'over snitt' value sits right-of-center", () => {
    // value between p50 and p90 ⇒ level label 'over snitt' ⇒ marker must be
    // in the 50–90% band, never pegged to an edge.
    const g: Bounds = { min: 0, max: 1000, p10: 5, p50: 20, p90: 60 };
    const pos = gaugePositionPct(40, g);
    expect(pos).toBeGreaterThan(50);
    expect(pos).toBeLessThan(90);
  });

  it("clamps values outside the recorded range to the edges", () => {
    const g: Bounds = { min: 10, max: 100, p10: 20, p50: 50, p90: 80 };
    expect(gaugePositionPct(5, g)).toBe(0);
    expect(gaugePositionPct(200, g)).toBe(100);
  });

  it("returns the neutral midpoint when the distribution is flat", () => {
    const g: Bounds = { min: 42, max: 42, p10: 42, p50: 42, p90: 42 };
    expect(gaugePositionPct(42, g)).toBe(50);
  });

  it("handles degenerate (equal) lower anchors without NaN", () => {
    // Many identical low readings: min == p10 == p50. Must not divide by 0.
    const g: Bounds = { min: 0, max: 100, p10: 0, p50: 0, p90: 40 };
    const pos = gaugePositionPct(20, g); // between p50(0) and p90(40)
    expect(Number.isFinite(pos)).toBe(true);
    expect(pos).toBeGreaterThan(50);
    expect(pos).toBeLessThan(90);
  });
});
