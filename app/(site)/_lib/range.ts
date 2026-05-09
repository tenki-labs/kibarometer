// Shared time-range helpers for the public scrollers.
// `Range` is exported from time-range-toggle so the toggle stays the
// authoritative source for the vocabulary; the helpers here turn a `Range`
// into cutoffs and bucket keys.

import type { Range } from "@/app/(site)/_components/time-range-toggle";

const VALID_RANGES: Range[] = ["1m", "6m", "1y", "since-2024", "max"];

const SINCE_2024_MS = Date.UTC(2024, 0, 1);

export function parseRange(raw: string | null): Range {
  return VALID_RANGES.includes(raw as Range) ? (raw as Range) : "1m";
}

// For 1y / since-2024 / max we bucket monthly so the chart stays readable.
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
