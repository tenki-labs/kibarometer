"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { NorwayMap } from "@/app/(site)/jobbmarked/_components/norway-map";
import { RangeToggle, type Range } from "@/app/(site)/jobbmarked/_components/range-toggle";
import { StackedArea, type Series } from "@/app/(site)/jobbmarked/_components/stacked-area";
import type {
  BrregSnapshotCohort,
  BrregSnapshotDaily,
  BrregSnapshotGeography,
  BrregSnapshotHeadline,
  SnapshotGeography,
  TaxonomyCategory,
} from "@/lib/supabase";

import { CategoryList, type NaceCategoryLabel } from "./category-list";
import { CohortSurvival } from "./cohort-survival";
import { Hero } from "./hero";

type Props = {
  headline: BrregSnapshotHeadline | null;
  daily: BrregSnapshotDaily[];
  cohort: BrregSnapshotCohort[];
  geography: BrregSnapshotGeography[];
  categories: NaceCategoryLabel[];
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

function shouldBucketMonthly(r: Range): boolean {
  return r === "1y" || r === "max";
}

function dateKey(iso: string, monthly: boolean): string {
  return monthly ? iso.slice(0, 7) : iso.slice(0, 10);
}

function buildVolumeSeries(
  rows: BrregSnapshotDaily[],
  range: Range,
  nowMs: number,
): { series: Series; aiBand: Map<string, number> } {
  const cutoffDays = rangeToCutoffDays(range);
  const monthly = shouldBucketMonthly(range);
  const cutoffMs = cutoffDays === null ? -Infinity : nowMs - cutoffDays * 86_400_000;

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
  cohort,
  geography,
  categories,
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

  // Adapter: feed nace_categories into StackedArea via the occupation variant.
  // colorForCategory hashes the slug, so brreg slugs get stable colors.
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

  // Adapt brreg geography into the NAV NorwayMap's prop shape.
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
            <RangeToggle value={range} onChange={onRangeChange} />
          </div>
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            Daglige registreringer fra Brønnøysundregistrene, gruppert etter
            kibarometer-NACE-kategorier. AI-relevante foretak ligger som eget
            bånd nederst.
          </p>
          <div className="min-h-0 flex-1">
            <StackedArea
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
          <h2 className="text-lg font-medium tracking-tight sm:text-xl">
            Goldrush-diagnose: kohort-overlevelse
          </h2>
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            Andel foretak fra hvert registreringskvartal som fortsatt er aktive
            (ikke konkurs, ikke slettet). AI-relevante mot ikke-AI som
            kontroll-gruppe.
          </p>
          <div className="min-h-0 flex-1">
            <CohortSurvival rows={cohort} />
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
            <NorwayMap geography={geoForMap} />
          </div>
        </div>
      </section>
    </div>
  );
}
