"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import {
  AIShareAreaChart,
  type AIShareBucket,
} from "@/app/(site)/_components/ai-share-area-chart";
import {
  StackedAreaChart,
  type Series,
} from "@/app/(site)/_components/stacked-area-chart";
import {
  TimeRangeToggle,
  type Range,
} from "@/app/(site)/_components/time-range-toggle";
import {
  dateKey,
  parseRange,
  rangeCutoffMs,
  shouldBucketMonthly,
} from "@/app/(site)/_lib/range";
import {
  NorwayMap,
  type NorwayMapUnit,
} from "@/app/(site)/jobbmarked/_components/norway-map";
import type { NorwayFylkePath } from "@/lib/norway-paths";
import type {
  BrregSnapshotDaily,
  BrregSnapshotFounderAgeMonthly,
  BrregSnapshotGeography,
  BrregSnapshotHeadline,
  BrregSnapshotKeyword,
  SnapshotGeography,
  TaxonomyCategory,
} from "@/lib/supabase";

import { FounderAgeLines } from "./founder-age-lines";
import { Hero } from "./hero";
import { KeywordList } from "./keyword-list";

const MAP_UNIT: NorwayMapUnit = {
  ariaLabel: "Kart over nye AI-relevante foretak per fylke",
  itemNoun: "AI-relevante foretak",
  shareNoun: "AI-foretakene",
};

export type NaceCategoryLabel = {
  slug: string;
  label_no: string;
};

type Props = {
  headline: BrregSnapshotHeadline | null;
  daily: BrregSnapshotDaily[];
  founderAgeMonthly: BrregSnapshotFounderAgeMonthly[];
  keywords: BrregSnapshotKeyword[];
  geography: BrregSnapshotGeography[];
  categories: NaceCategoryLabel[];
  norwayPaths: readonly NorwayFylkePath[];
  norwayViewBox: string;
};

function buildAiShareBuckets(
  rows: BrregSnapshotDaily[],
  range: Range,
  nowMs: number,
): AIShareBucket[] {
  const cutoffMs = rangeCutoffMs(range, nowMs);
  const monthly = shouldBucketMonthly(range);
  const buckets = new Map<string, { ai: number; total: number }>();
  for (const row of rows) {
    const t = new Date(row.registrert_dato + "T00:00:00Z").getTime();
    if (t < cutoffMs) continue;
    const key = dateKey(row.registrert_dato, monthly);
    const cur = buckets.get(key) ?? { ai: 0, total: 0 };
    cur.ai += row.ai_relevant_count;
    cur.total += row.count;
    buckets.set(key, cur);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, aiCount: v.ai, totalCount: v.total }));
}

// Build a Series of category mix among AI-relevant new companies. Categories
// whose AI-relevant total over the active window is 0 are filtered out, so
// the chart and legend never show empty bands.
function buildCategoryMixSeries(
  rows: BrregSnapshotDaily[],
  range: Range,
  nowMs: number,
): Series {
  const cutoffMs = rangeCutoffMs(range, nowMs);
  const monthly = shouldBucketMonthly(range);
  const buckets = new Map<string, Map<string, number>>();
  const slugTotals = new Map<string, number>();
  for (const row of rows) {
    const t = new Date(row.registrert_dato + "T00:00:00Z").getTime();
    if (t < cutoffMs) continue;
    if (row.ai_relevant_count === 0) continue;
    const bucket = dateKey(row.registrert_dato, monthly);
    if (!buckets.has(bucket)) buckets.set(bucket, new Map());
    const inner = buckets.get(bucket)!;
    inner.set(
      row.nace_category_slug,
      (inner.get(row.nace_category_slug) ?? 0) + row.ai_relevant_count,
    );
    slugTotals.set(
      row.nace_category_slug,
      (slugTotals.get(row.nace_category_slug) ?? 0) + row.ai_relevant_count,
    );
  }
  const sortedDates = [...buckets.keys()].sort();
  const liveKeys = [...slugTotals.entries()]
    .filter(([, n]) => n > 0)
    .map(([k]) => k);
  return {
    dates: sortedDates,
    keys: liveKeys,
    values: sortedDates.map((d) => {
      const inner = buckets.get(d)!;
      return liveKeys.map((k) => inner.get(k) ?? 0);
    }),
  };
}

export function Scroller({
  headline,
  daily,
  founderAgeMonthly,
  keywords,
  geography,
  categories,
  norwayPaths,
  norwayViewBox,
}: Props) {
  const searchParams = useSearchParams();
  const initialRange = parseRange(searchParams.get("range"));
  const [range, setRange] = useState<Range>(initialRange);

  // Sync the URL via history.replaceState rather than Next.js router.replace
  // so the snap-scroll container's scroll position is never perturbed — the
  // router path can interact subtly with the segment layout and bounce the
  // user back to the hero on each click. Mirrors /jobbmarked.
  function onRangeChange(next: Range) {
    setRange(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === "1m") params.delete("range");
    else params.set("range", next);
    const qs = params.toString();
    const url = qs ? `/oppstart?${qs}` : "/oppstart";
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", url);
    }
  }

  // Reference "now" derived from the data — the latest registrert_dato across
  // the daily snapshot. Avoids Date.now() during render and gives stable
  // cutoffs whether the page renders at 03:59 or 04:01.
  const nowMs = useMemo(() => {
    let latest = 0;
    for (const row of daily) {
      const t = new Date(row.registrert_dato + "T00:00:00Z").getTime();
      if (t > latest) latest = t;
    }
    return latest || 0;
  }, [daily]);

  const aiShareBuckets = useMemo(
    () => buildAiShareBuckets(daily, range, nowMs),
    [daily, range, nowMs],
  );

  const categoryMixSeries = useMemo(
    () => buildCategoryMixSeries(daily, range, nowMs),
    [daily, range, nowMs],
  );

  const taxonomyAdapter = useMemo<TaxonomyCategory[]>(
    () =>
      categories.map((c, i) => ({
        slug: c.slug,
        title: c.label_no,
        definition_md: c.label_no,
        sort_order: i,
      })),
    [categories],
  );

  const geoForMap = useMemo<SnapshotGeography[]>(
    () =>
      geography.map((g) => ({
        county: g.fylke,
        ai_count_30d: g.ai_relevant_count_30d,
        total_count_30d: g.count_30d,
      })),
    [geography],
  );

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
              AI-andel av nye foretak
            </h2>
            <TimeRangeToggle value={range} onChange={onRangeChange} />
          </div>
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            Andelen nyregistrerte foretak fra Brønnøysundregistrene som
            klassifiseres som AI-relevante, gruppert per dag eller måned.
          </p>
          <div className="min-h-0 flex-1">
            <AIShareAreaChart buckets={aiShareBuckets} unitLabel="foretak" />
          </div>
        </div>
      </section>

      <section className="snap-segment sm:snap-start sm:snap-always">
        <div className="flex h-full w-full flex-col gap-4 px-4 pt-6 pb-8 sm:px-8">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-medium tracking-tight sm:text-xl">
              Topp kategorier — etter AI-andel
            </h2>
            <TimeRangeToggle value={range} onChange={onRangeChange} />
          </div>
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            Næringskategorier blant AI-relevante nyregistreringer, normalisert
            til 100 % per periode. Kategorier uten AI-relevante foretak i
            valgt vindu utelates.
          </p>
          <div className="min-h-0 flex-1">
            <StackedAreaChart
              series={categoryMixSeries}
              taxonomy={taxonomyAdapter}
              variant="skill"
              normalize
            />
          </div>
        </div>
      </section>

      <section className="snap-segment sm:snap-start sm:snap-always">
        <div className="flex h-full w-full flex-col gap-4 px-4 pt-6 pb-8 sm:px-8">
          <h2 className="text-lg font-medium tracking-tight sm:text-xl">
            Mest brukte AI-fraser i nye foretak siste 30 dager
          </h2>
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            Treff mot kuraterte AI-nøkkelord i firmanavn og aktivitetsbeskrivelse
            ved registrering. YoY sammenligner mot samme 30-dagers vindu i fjor;
            «ny» betyr ingen treff i fjorårets vindu.
          </p>
          <div className="min-h-0 flex-1 overflow-auto">
            <KeywordList rows={keywords} />
          </div>
        </div>
      </section>

      <section className="snap-segment sm:snap-start sm:snap-always">
        <div className="flex h-full w-full flex-col gap-4 px-4 pt-6 pb-8 sm:px-8">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-medium tracking-tight sm:text-xl">
              Median alder ved registrering — AI vs ikke-AI
            </h2>
            <TimeRangeToggle value={range} onChange={onRangeChange} />
          </div>
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            Medianalder på yngste registrerte rolleinnehaver ved
            registreringstidspunktet, per måned. To linjer sammenligner
            AI-relevante foretak mot resten. Tooltip viser kvartilavstand
            og utvalg.
          </p>
          <div className="min-h-0 flex-1">
            <FounderAgeLines
              rows={founderAgeMonthly}
              range={range}
              nowMs={nowMs}
            />
          </div>
        </div>
      </section>

      <section className="snap-segment sm:snap-start sm:snap-always">
        <div className="flex h-full w-full flex-col gap-4 px-4 pt-6 pb-8 sm:px-8">
          <h2 className="text-lg font-medium tracking-tight sm:text-xl">
            Geografi — nye foretak per fylke
          </h2>
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            Siste 30 dager. Kartet farges etter AI-andel per fylke.
          </p>
          <div className="min-h-0 flex-1">
            <NorwayMap
              geography={geoForMap}
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
