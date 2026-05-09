import type { TimeRangeOption } from "@/app/(site)/_components/time-range-toggle";

export type OppstartRange = "30d" | "12m" | "since-2022" | "since-2018";

export const OPPSTART_RANGE_OPTIONS: TimeRangeOption<OppstartRange>[] = [
  { value: "30d", label: "30 dager" },
  { value: "12m", label: "12 mnd" },
  { value: "since-2022", label: "Siden 2022" },
  { value: "since-2018", label: "Siden 2018" },
];

const VALID = new Set<OppstartRange>([
  "30d",
  "12m",
  "since-2022",
  "since-2018",
]);

export function parseOppstartRange(raw: string | null): OppstartRange {
  return raw && VALID.has(raw as OppstartRange)
    ? (raw as OppstartRange)
    : "12m";
}

export function rangeToCutoffMs(r: OppstartRange, nowMs: number): number {
  switch (r) {
    case "30d":
      return nowMs - 30 * 86_400_000;
    case "12m":
      return nowMs - 365 * 86_400_000;
    case "since-2022":
      return Date.UTC(2022, 0, 1);
    case "since-2018":
      return Date.UTC(2018, 0, 1);
  }
}

export function shouldBucketMonthly(r: OppstartRange): boolean {
  return r !== "30d";
}
