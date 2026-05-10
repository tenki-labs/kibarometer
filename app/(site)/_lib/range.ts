// Shared time-range helpers for the public scrollers.
// `Range` is exported from time-range-toggle so the toggle stays the
// authoritative source for the vocabulary; the helpers here turn a `Range`
// into cutoffs and bucket keys.

import type { Range } from "@/app/(site)/_components/time-range-toggle";

const VALID_RANGES: Range[] = ["1m", "6m", "1y", "since-2024", "max"];

const SINCE_2024_MS = Date.UTC(2024, 0, 1);

// Below this many calendar-month buckets, monthly bucketing degenerates
// into a 1–2-point wedge under recharts' linear interpolation. Fall back
// to daily bucketing instead.
export const MIN_MONTHLY_BUCKETS = 3;

export function parseRange(raw: string | null): Range {
  return VALID_RANGES.includes(raw as Range) ? (raw as Range) : "1m";
}

// For 1y / since-2024 / max we *prefer* monthly bucketing. Whether it's
// actually used also depends on data coverage — see effectiveMonthly().
export function shouldBucketMonthly(r: Range): boolean {
  return r === "1y" || r === "since-2024" || r === "max";
}

// YYYY-MM (monthly) or YYYY-MM-DD (daily) projected from an ISO date.
export function dateKey(iso: string, monthly: boolean): string {
  return monthly ? iso.slice(0, 7) : iso.slice(0, 10);
}

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

// Decide whether a chart should bucket monthly given the active range and
// the data's coverage. Returns true only when the visible window spans
// at least MIN_MONTHLY_BUCKETS calendar months of actual data.
//
// Without this guard, picking "1 år" or "Maks" on a dataset that only
// goes back five weeks renders monthly-bucketed as 1–2 points and
// recharts interpolates a triangular wedge. Falling back to daily keeps
// the chart honest and continuous.
export function effectiveMonthly(
  r: Range,
  coverageMs: number,
  nowMs: number,
): boolean {
  if (!shouldBucketMonthly(r)) return false;
  if (!Number.isFinite(coverageMs)) return false;
  const cutoff = rangeCutoffMs(r, nowMs);
  const start = Math.max(cutoff, coverageMs);
  if (start > nowMs) return false;
  const startDate = new Date(start);
  const endDate = new Date(nowMs);
  const months =
    (endDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12 +
    (endDate.getUTCMonth() - startDate.getUTCMonth()) +
    1;
  return months >= MIN_MONTHLY_BUCKETS;
}
