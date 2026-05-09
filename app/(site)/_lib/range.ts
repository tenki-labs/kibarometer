// Shared time-range helpers for the public scrollers (/jobbmarked, /media).
// `Range` is exported from time-range-toggle so the toggle stays the
// authoritative source for the vocabulary; the helpers here turn a `Range`
// into cutoffs and bucket keys.

import type { Range } from "@/app/(site)/_components/time-range-toggle";

const VALID_RANGES: Range[] = ["1m", "1q", "1y", "max"];

export function parseRange(raw: string | null): Range {
  return VALID_RANGES.includes(raw as Range) ? (raw as Range) : "1m";
}

export function rangeToCutoffDays(r: Range): number | null {
  switch (r) {
    case "1m": return 30;
    case "1q": return 90;
    case "1y": return 365;
    case "max": return null;
  }
}

// For 1y/max we bucket to month so the chart stays readable.
export function shouldBucketMonthly(r: Range): boolean {
  return r === "1y" || r === "max";
}

// YYYY-MM (monthly) or YYYY-MM-DD (daily) projected from an ISO date.
export function dateKey(iso: string, monthly: boolean): string {
  return monthly ? iso.slice(0, 7) : iso.slice(0, 10);
}

export function rangeCutoffMs(r: Range, nowMs: number): number {
  const days = rangeToCutoffDays(r);
  return days === null ? -Infinity : nowMs - days * 86_400_000;
}
