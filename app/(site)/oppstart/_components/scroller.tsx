"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { StackedBarChart } from "@/app/(site)/_components/stacked-bar-chart";
import type { Series } from "@/app/(site)/_components/stacked-area-chart";
import { TimeRangeToggle } from "@/app/(site)/_components/time-range-toggle";
import {
  NorwayMap,
  type NorwayMapUnit,
} from "@/app/(site)/jobbmarked/_components/norway-map";
import type { NorwayFylkePath } from "@/lib/norway-paths";

const MAP_UNIT: NorwayMapUnit = {
  ariaLabel: "Kart over nye AI-relevante foretak per fylke",
  itemNoun: "AI-relevante foretak",
  shareNoun: "AI-foretakene",
};
import type {
  BrregSnapshotDaily,
  BrregSnapshotFounderAgeYearly,
  BrregSnapshotGeography,
  BrregSnapshotHeadline,
  SnapshotGeography,
  TaxonomyCategory,
} from "@/lib/supabase";

import { AiShareBars } from "./ai-share-bars";
import { CategoryList, type NaceCategoryLabel } from "./category-list";
import { FounderAgeBars } from "./founder-age-bars";
import { Hero } from "./hero";
import {
  OPPSTART_RANGE_OPTIONS,
  parseOppstartRange,
  rangeToCutoffMs,
  shouldBucketMonthly,
  type OppstartRange,
} from "./range-utils";

type Props = {
  headline: BrregSnapshotHeadline | null;
  daily: BrregSnapshotDaily[];
  founderAge: BrregSnapshotFounderAgeYearly[];
  geography: BrregSnapshotGeography[];
  categories: NaceCategoryLabel[];
  norwayPaths: readonly NorwayFylkePath[];
  norwayViewBox: string;
};

function dateKey(iso: string, monthly: boolean): string {
  return monthly ? iso.slice(0, 7) : iso.slice(0, 10);
}

function buildVolumeSeries(
  rows: BrregSnapshotDaily[],
  range: OppstartRange,
  nowMs: number,
): { series: Series; aiBand: Map<string, number> } {
  const cutoffMs = rangeToCutoffMs(range, nowMs);
  const monthly = shouldBucketMonthly(range);

  const buckets = new Map<string, Map<string, number>>();
  const aiBand = new Map<string, number>();
  const keys = new Set<string>();

  for (const row of rows) {
    const t = new Date(row.registrert_dato + "T00:00:00Z").getTime();
    if (t < cutoffMs) continue;
    if (row.count === 0) continue;
    const bucket = dateKey(row.registrert_dato, monthly);
    keys.add(row.nace_category_slug);
    if (!buckets.has(bucket)) buckets.set(bucket, new Map());
    const inner = buckets.get(bucket)!;
    inner.set(
      row.nace_category_slug,
      (inner.get(row.nace_category_slug) ?? 0) + row.count,
    );
    if (row.ai_relevant_count > 0) {
      aiBand.set(bucket, (aiBand.get(bucket) ?? 0) + row.ai_relevant_count);
    }
  }

  const sortedDates = [...buckets.keys()].sort();
  const sortedKeys = [...keys];
  return {
    series: {
      dates: sortedDates,
      keys: sortedKeys,
      values: sortedDates.map((d) => {
        const inner = buckets.get(d)!;
        return sortedKeys.map((k) => inner.get(k) ?? 0);
      }),
    },
    aiBand,
  };
}

export function Scroller({
  headline,
  daily,
  founderAge,
  geography,
  categories,
  norwayPaths,
  norwayViewBox,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialRange = parseOppstartRange(searchParams.get("range"));
  const [range, setRange] = useState<OppstartRange>(initialRange);

  function onRangeChange(next: OppstartRange) {
    setRange(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === "12m") params.delete("range");
    else params.set("range", next);
    const qs = params.toString();
    router.replace(qs ? `/oppstart?${qs}` : "/oppstart", { scroll: false });
  }

  const nowMs = useMemo(() => {
    let latest = 0;
    for (const row of daily) {
      const t = new Date(row.registrert_dato + "T00:00:00Z").getTime();
      if (t > latest) latest = t;
    }
    return latest || 0;
  }, [daily]);

  const { series: volumeSeries, aiBand } = useMemo(
    () => buildVolumeSeries(daily, range, nowMs),
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

  const categoryListCutoffMs = nowMs - 30 * 86_400_000;

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
              Nye foretak per næringskategori
            </h2>
            <TimeRangeToggle<OppstartRange>
              value={range}
              onChange={onRangeChange}
              options={OPPSTART_RANGE_OPTIONS}
            />
          </div>
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            Daglige registreringer fra Brønnøysundregistrene, gruppert etter
            kibarometer-NACE-kategorier. AI-relevante foretak ligger som eget
            bånd nederst i hver søyle.
          </p>
          <div className="min-h-0 flex-1">
            <StackedBarChart
              series={volumeSeries}
              aiBandValues={aiBand}
              taxonomy={taxonomyAdapter}
              variant="occupation"
            />
          </div>
        </div>
      </section>

      <section className="snap-segment sm:snap-start sm:snap-always">
        <div className="flex h-full w-full flex-col gap-4 px-4 pt-6 pb-8 sm:px-8">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-medium tracking-tight sm:text-xl">
              AI-andel av nye foretak
            </h2>
            <TimeRangeToggle<OppstartRange>
              value={range}
              onChange={onRangeChange}
              options={OPPSTART_RANGE_OPTIONS}
            />
          </div>
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            Andel nyregistrerte foretak fra Brønnøysundregistrene som
            klassifiseres som AI-relevante. Hver søyle går fra 0 til 100 % —
            det oransje feltet viser AI-andelen, det grå alt annet. Søyler
            med færre enn 25 foretak er svakere fargelagt.
          </p>
          <div className="min-h-0 flex-1">
            <AiShareBars rows={daily} range={range} nowMs={nowMs} />
          </div>
        </div>
      </section>

      <section className="snap-segment sm:snap-start sm:snap-always">
        <div className="flex h-full w-full flex-col gap-4 px-4 pt-6 pb-8 sm:px-8">
          <h2 className="text-lg font-medium tracking-tight sm:text-xl">
            Yngste grunnlegger ved registrering — AI vs ikke-AI
          </h2>
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            Median alder på yngste registrerte rolleinnehaver ved
            registreringstidspunktet, per år. AI-relevante mot ikke-AI som
            kontroll-gruppe. Søyler med færre enn 25 foretak er svakere
            fargelagt; tooltip viser kvartilavstand og utvalg.
          </p>
          <div className="min-h-0 flex-1">
            <FounderAgeBars rows={founderAge} />
          </div>
        </div>
      </section>

      <section className="snap-segment sm:snap-start sm:snap-always">
        <div className="flex h-full w-full flex-col gap-4 px-4 pt-6 pb-8 sm:px-8">
          <h2 className="text-lg font-medium tracking-tight sm:text-xl">
            Topp kategorier siste 30 dager — etter AI-andel
          </h2>
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            Næringskategorier rangert etter andel nyregistrerte foretak som
            klassifiseres som AI-relevante. Kategorier med færre enn 25 foretak
            i perioden er demped.
          </p>
          <div className="min-h-0 flex-1 overflow-auto">
            <CategoryList
              rows={daily}
              labels={categories}
              cutoffMs={categoryListCutoffMs}
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
