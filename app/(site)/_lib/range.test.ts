import { describe, expect, it } from "vitest";

import { grainForSpanMs, rangeCutoffMs, unavailableRanges } from "./range";

const DAY = 86_400_000;

// Regression guard for the disabled-"max" bug: unavailableRanges greys ranges
// whose trailing window reaches before the earliest data (they'd render
// identically to "max"). "max" is that reference window — it must never grey
// itself, or a young pillar like /arbeidsmarked (data only since the cutoff, so
// every finite window predates it) is left with no full-period option at all.

const NOW = Date.UTC(2026, 8, 9); // 2026-09-09

describe("unavailableRanges", () => {
  it('never greys "max" for any finite earliest', () => {
    for (const earliest of [
      Date.UTC(2019, 0, 1),
      Date.UTC(2024, 0, 1),
      Date.UTC(2026, 3, 13),
      NOW,
    ]) {
      expect(unavailableRanges(earliest, NOW)).not.toContain("max");
    }
  });

  it("greys the sub-cutoff trailing ranges on a young pillar (/arbeidsmarked shape)", () => {
    // earliest = JOBBMARKED_DATA_CUTOFF (2026-04-13): only ~5 months of data,
    // so 6m/1y/since-2024 all reach before it; 1m and max stay live.
    const earliest = Date.UTC(2026, 3, 13);
    expect(unavailableRanges(earliest, NOW)).toEqual(["6m", "1y", "since-2024"]);
  });

  it("greys nothing when data reaches back years (/offentlig shape)", () => {
    const earliest = Date.UTC(2019, 0, 1);
    expect(unavailableRanges(earliest, NOW)).toEqual([]);
  });

  it("greys nothing for a non-finite / empty-dataset horizon", () => {
    expect(unavailableRanges(Infinity, NOW)).toEqual([]);
    expect(unavailableRanges(Number.NaN, NOW)).toEqual([]);
  });
});

describe("rangeCutoffMs", () => {
  it('resolves "max" to -Infinity (earliest available data → now)', () => {
    expect(rangeCutoffMs("max", NOW)).toBe(-Infinity);
  });
});

describe("grainForSpanMs (open-ended max window)", () => {
  it("uses weekly for the ~5-month /arbeidsmarked span (not monthly)", () => {
    // cutoff 2026-04-13 → now 2026-09-09 ≈ 149 days: the case that regressed
    // to ~6 monthly dots before this fix.
    expect(grainForSpanMs(149 * DAY)).toBe("week");
  });

  it("uses monthly for a multi-year span (media/offentlig max)", () => {
    expect(grainForSpanMs(985 * DAY)).toBe("month"); // ~2.7 y
    expect(grainForSpanMs(2555 * DAY)).toBe("month"); // ~7 y
  });

  it("uses daily for a short span", () => {
    expect(grainForSpanMs(30 * DAY)).toBe("day");
  });

  it("honours the day/week/month boundaries", () => {
    expect(grainForSpanMs(49 * DAY)).toBe("day");
    expect(grainForSpanMs(50 * DAY)).toBe("week");
    expect(grainForSpanMs(550 * DAY)).toBe("week");
    expect(grainForSpanMs(551 * DAY)).toBe("month");
  });
});
