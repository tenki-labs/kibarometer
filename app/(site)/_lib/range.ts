// Shared time-range helpers for the public scrollers.
//
// IMPORTANT: every `Range` value names a TRAILING window ending at "now".
// "1m"         = most recent 30 days (today−30 → today).
// "6m"         = most recent ~182 days.
// "1y"         = most recent 365 days.
// "since-2024" = fixed start 2024-01-01 → today.
// "max"        = earliest available data → today.
// NEVER interpret any range as "the first N days of available data" — it
// never means that, anywhere in this codebase. AI agents miscoding charts
// that way is the exact failure mode this module is designed against.

import type { Range } from "@/app/(site)/_components/time-range-toggle";

const VALID_RANGES: Range[] = ["1m", "6m", "1y", "since-2024", "max"];

const SINCE_2024_MS = Date.UTC(2024, 0, 1);

export function parseRange(raw: string | null): Range {
  return VALID_RANGES.includes(raw as Range) ? (raw as Range) : "1m";
}

// Canonical Range → bucket-grain mapping. Adding a new `Range` value
// forces an exhaustive update here at compile time. Don't fork — extend.
//
// Note: `month` is a valid grain but is never produced by `bucketGrainForRange`
// — no public range maps to monthly. It exists for charts that read from
// an intrinsically-monthly snapshot table (e.g. brreg_snapshot_founder_age_monthly),
// which pass `"month"` directly to `dateKey`.
export type BucketGrain = "day" | "week" | "month";

export function bucketGrainForRange(r: Range): BucketGrain {
  switch (r) {
    case "1m":          return "day";
    case "6m":          return "week";
    case "1y":          return "week";
    case "since-2024":  return "week";
    case "max":         return "week";
  }
}

// YYYY-MM-DD (daily), YYYY-Www (ISO 8601 weekly), or YYYY-MM (monthly)
// projected from an ISO date. Bucket keys sort lexicographically in
// chronological order in all three formats, including across year boundaries.
export function dateKey(iso: string, grain: BucketGrain): string {
  switch (grain) {
    case "day":   return iso.slice(0, 10);
    case "week":  return isoWeekKey(iso);
    case "month": return iso.slice(0, 7);
  }
}

function isoWeekKey(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  // ISO 8601: Thursday's calendar year = the week's year. Norwegian
  // convention follows ISO; week starts Monday.
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const year = d.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

// Lower bound (inclusive) of the trailing window in milliseconds. Pair
// with `if (t < cutoff) continue;` to keep rows newer than the cutoff.
// Never an upper bound; the upper bound is always "now".
export function rangeCutoffMs(r: Range, nowMs: number): number {
  switch (r) {
    case "1m":          return nowMs - 30 * 86_400_000;
    case "6m":          return nowMs - 182 * 86_400_000;
    case "1y":          return nowMs - 365 * 86_400_000;
    case "since-2024":  return SINCE_2024_MS;
    case "max":         return -Infinity;
  }
}

// Earliest data point in milliseconds. Returns +Infinity for an empty
// dataset so callers can fall back to nowMs without a special case.
// Used by /media's scroller to drive the "data goes back to X" coverage
// banner — independent of grain selection.
export function coverageHorizonMs(
  rows: ReadonlyArray<{ published_on?: string; date?: string }>,
): number {
  let earliest = Infinity;
  for (const row of rows) {
    const iso = row.published_on ?? row.date;
    if (!iso) continue;
    const t = new Date(iso + "T00:00:00Z").getTime();
    if (Number.isFinite(t) && t < earliest) earliest = t;
  }
  return earliest;
}
