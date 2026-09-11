import { describe, expect, it } from "vitest";

import { dateKey } from "@/app/(site)/_lib/range";
import { formatBucket, formatBucketShort, isoWeekMondayUTC } from "./bucket-format";

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("isoWeekMondayUTC (inverse of dateKey week grain)", () => {
  it("2026-W17 starts Monday 2026-04-20", () => {
    expect(iso(isoWeekMondayUTC(2026, 17))).toBe("2026-04-20");
  });

  it("returns a Monday that roundtrips through dateKey(_, 'week')", () => {
    const cases: [number, number][] = [
      [2025, 1],
      [2026, 1], // ISO week 1 starts in the previous calendar year (2025-12-29)
      [2026, 16], // the /arbeidsmarked cutoff week (2026-04-13)
      [2026, 37],
      [2026, 52],
      [2027, 1],
    ];
    for (const [y, w] of cases) {
      const mon = isoWeekMondayUTC(y, w);
      expect(mon.getUTCDay()).toBe(1); // Monday
      expect(dateKey(iso(mon), "week")).toBe(`${y}-W${String(w).padStart(2, "0")}`);
    }
  });
});

describe("weekly bucket labels are dates, not week numbers", () => {
  it("axis label is the week's date, no 'u'/week number", () => {
    const label = formatBucketShort("2026-W16");
    expect(label).not.toMatch(/uke|^u\d/i);
    expect(label).toMatch(/\d/); // contains a day number
  });

  it("tooltip label is a date range, not 'Uke N'", () => {
    const label = formatBucket("2026-W16");
    expect(label).not.toMatch(/uke/i);
    expect(label).toContain("–"); // start – end range
  });

  it("daily and monthly keys are unaffected", () => {
    expect(formatBucketShort("2026-05")).not.toContain("–");
    expect(formatBucketShort("2026-05-04")).not.toMatch(/uke|^u\d/i);
  });
});
