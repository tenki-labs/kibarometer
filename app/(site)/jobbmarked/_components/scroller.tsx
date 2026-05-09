"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import type {
  SnapshotCategoryDaily,
  SnapshotGeography,
  SnapshotHeadline,
  SnapshotKeyword,
  SnapshotSkillCategoryDaily,
  TaxonomyCategory,
} from "@/lib/supabase";

import {
  StackedAreaChart,
  type Series,
} from "@/app/(site)/_components/stacked-area-chart";
import {
  TimeRangeToggle,
  type Range,
} from "@/app/(site)/_components/time-range-toggle";

import { Hero } from "./hero";
import { KeywordList } from "./keyword-list";
import { NorwayMap, type NorwayMapUnit } from "./norway-map";
import type { NorwayFylkePath } from "@/lib/norway-paths";

const MAP_UNIT: NorwayMapUnit = {
  ariaLabel: "Kart over AI-stillinger per fylke",
  itemNoun: "AI-stillinger",
  shareNoun: "AI-stillingene",
};

type Props = {
  headline: SnapshotHeadline | null;
  categoryDaily: SnapshotCategoryDaily[];
  skillCategoryDaily: SnapshotSkillCategoryDaily[];
  keywords: SnapshotKeyword[];
  geography: SnapshotGeography[];
  taxonomy: TaxonomyCategory[];
  norwayPaths: readonly NorwayFylkePath[];
  norwayViewBox: string;
};

const VALID_RANGES: Range[] = ["1m", "1q", "1y", "max"];

function parseRange(raw: string | null): Range {
  return VALID_RANGES.includes(raw as Range) ? (raw as Range) : "1m";
}

function rangeToCutoffDays(r: Range): number | null {
  switch (r) {
    case "1m": return 30;
    case "1q": return 90;
    case "1y": return 365;
    case "max": return null;
  }
}

// For 1y/max we bucket to month so the chart stays readable.
function shouldBucketMonthly(r: Range): boolean {
  return r === "1y" || r === "max";
}

function dateKey(iso: string, monthly: boolean): string {
  return monthly ? iso.slice(0, 7) : iso.slice(0, 10); // YYYY-MM vs YYYY-MM-DD
}

// Slice + bucket the per-day snapshots into a Series the chart can render.
// `getKey` projects each row to its bucket key (category or slug). `nowMs`
// is the reference "current time" used for the range cutoff — passed in by
// the caller so it stays deterministic across the render pass.
function buildSeries<R extends { posted_on: string; ai_count: number; total_count?: number }>(
  rows: R[],
  range: Range,
  getKey: (row: R) => string,
  metric: "ai" | "total",
  nowMs: number,
): Series {
  const cutoffDays = rangeToCutoffDays(range);
  const monthly = shouldBucketMonthly(range);
  const cutoffMs = cutoffDays === null ? -Infinity : nowMs - cutoffDays * 86_400_000;

  // Group: dateBucket -> (categoryKey -> count)
  const buckets = new Map<string, Map<string, number>>();
  const keys = new Set<string>();

  for (const row of rows) {
    const t = new Date(row.posted_on + "T00:00:00Z").getTime();
    if (t < cutoffMs) continue;
    const value = metric === "ai" ? row.ai_count : (row.total_count ?? 0);
    if (value === 0) continue;
    const bucket = dateKey(row.posted_on, monthly);
    const key = getKey(row);
    keys.add(key);
    if (!buckets.has(bucket)) buckets.set(bucket, new Map());
    const inner = buckets.get(bucket)!;
    inner.set(key, (inner.get(key) ?? 0) + value);
  }

  const sortedDates = [...buckets.keys()].sort();
  const sortedKeys = [...keys];
  return {
    dates: sortedDates,
    keys: sortedKeys,
    values: sortedDates.map((d) => {
      const inner = buckets.get(d)!;
      return sortedKeys.map((k) => inner.get(k) ?? 0);
    }),
  };
}

export function Scroller({
  headline,
  categoryDaily,
  skillCategoryDaily,
  keywords,
  geography,
  taxonomy,
  norwayPaths,
  norwayViewBox,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialRange = parseRange(searchParams.get("range"));
  const [range, setRange] = useState<Range>(initialRange);

  function onRangeChange(next: Range) {
    setRange(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === "1m") params.delete("range");
    else params.set("range", next);
    const qs = params.toString();
    router.replace(qs ? `/jobbmarked?${qs}` : "/jobbmarked", { scroll: false });
  }

  // Reference "now" derived from the data — the latest posted_on across the
  // two daily snapshots. Avoids Date.now() during render and gives stable
  // cutoffs whether the page renders at 03:59 or 04:01.
  const nowMs = useMemo(() => {
    let latest = 0;
    for (const row of categoryDaily) {
      const t = new Date(row.posted_on + "T00:00:00Z").getTime();
      if (t > latest) latest = t;
    }
    for (const row of skillCategoryDaily) {
      const t = new Date(row.posted_on + "T00:00:00Z").getTime();
      if (t > latest) latest = t;
    }
    return latest || 0;
  }, [categoryDaily, skillCategoryDaily]);

  const occupationSeries = useMemo(
    () => buildSeries(categoryDaily, range, (r) => r.category, "total", nowMs),
    [categoryDaily, range, nowMs],
  );

  const skillSeries = useMemo(
    () => buildSeries(skillCategoryDaily, range, (r) => r.slug, "ai", nowMs),
    [skillCategoryDaily, range, nowMs],
  );

  // Build a synthetic "AI" band layered at the bottom of segment 2: its values
  // are the per-bucket sum of ai_count across all categories.
  const aiBandValues = useMemo(() => {
    const cutoffDays = rangeToCutoffDays(range);
    const monthly = shouldBucketMonthly(range);
    const cutoffMs = cutoffDays === null ? -Infinity : nowMs - cutoffDays * 86_400_000;
    const buckets = new Map<string, number>();
    for (const row of categoryDaily) {
      const t = new Date(row.posted_on + "T00:00:00Z").getTime();
      if (t < cutoffMs) continue;
      if (row.ai_count === 0) continue;
      const bucket = dateKey(row.posted_on, monthly);
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + row.ai_count);
    }
    return buckets;
  }, [categoryDaily, range, nowMs]);

  // Container is a snap scroller from sm: up. On mobile we let normal page
  // scroll handle things and skip the cinematic effect.
  return (
    <div
      className="
        flex flex-col
        sm:h-[calc(100svh-3.5rem)] sm:overflow-y-scroll
        sm:snap-y sm:snap-mandatory
      "
    >
      <section className="snap-segment sm:snap-start sm:snap-always">
        <Hero headline={headline} />
      </section>

      <section className="snap-segment sm:snap-start sm:snap-always">
        <div className="flex h-full w-full flex-col gap-4 px-4 pt-6 pb-8 sm:px-8">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-medium tracking-tight sm:text-xl">
              Norsk arbeidsmarked
            </h2>
            <TimeRangeToggle value={range} onChange={onRangeChange} />
          </div>
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            Stillinger fra NAVs feed gruppert etter yrkeskategori. AI-relaterte
            stillinger ligger som eget bånd nederst.
          </p>
          <div className="min-h-0 flex-1">
            <StackedAreaChart
              series={occupationSeries}
              aiBandValues={aiBandValues}
              taxonomy={taxonomy}
              variant="occupation"
            />
          </div>
        </div>
      </section>

      <section className="snap-segment sm:snap-start sm:snap-always">
        <div className="flex h-full w-full flex-col gap-4 px-4 pt-6 pb-8 sm:px-8">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-medium tracking-tight sm:text-xl">
              AI-stillinger etter ferdighet
            </h2>
            <TimeRangeToggle value={range} onChange={onRangeChange} />
          </div>
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            AI-stillinger klassifisert av en språkmodell etter
            ferdighetskategori. Én stilling kan tilhøre flere kategorier.
          </p>
          <div className="min-h-0 flex-1">
            <StackedAreaChart
              series={skillSeries}
              taxonomy={taxonomy}
              variant="skill"
            />
          </div>
        </div>
      </section>

      <section className="snap-segment sm:snap-start sm:snap-always">
        <div className="flex h-full w-full flex-col gap-4 px-4 pt-6 pb-8 sm:px-8">
          <h2 className="text-lg font-medium tracking-tight sm:text-xl">
            Mest brukte AI-nøkkelord siste 30 dager
          </h2>
          <div className="min-h-0 flex-1 overflow-auto">
            <KeywordList rows={keywords} />
          </div>
        </div>
      </section>

      <section className="snap-segment sm:snap-start sm:snap-always">
        <div className="flex h-full w-full flex-col gap-4 px-4 pt-6 pb-8 sm:px-8">
          <h2 className="text-lg font-medium tracking-tight sm:text-xl">
            AI-stillinger etter fylke
          </h2>
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            Geografisk fordeling av AI-relaterte stillinger siste 30 dager,
            normalisert til dagens 15 fylker.
          </p>
          <div className="min-h-0 flex-1">
            <NorwayMap
              geography={geography}
              paths={norwayPaths}
              viewBox={norwayViewBox}
              unit={MAP_UNIT}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
