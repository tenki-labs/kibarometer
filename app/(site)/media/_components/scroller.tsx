"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { RangeToggle, type Range } from "@/app/(site)/jobbmarked/_components/range-toggle";
import { StackedArea, type Series } from "@/app/(site)/jobbmarked/_components/stacked-area";
import type {
  MediaAnomalyDaily,
  MediaCategory,
  MediaSnapshotCategoryDaily,
  MediaSnapshotIndex,
  TaxonomyCategory,
} from "@/lib/supabase";

import { AnomalyFeed } from "./anomaly-feed";
import { CategoryList } from "./category-list";
import { Hero } from "./hero";
import { IndexLine } from "./index-line";

type Props = {
  latest: MediaSnapshotIndex | null;
  indexHistory: MediaSnapshotIndex[];
  categoryDaily: MediaSnapshotCategoryDaily[];
  categories: MediaCategory[];
  anomalies: MediaAnomalyDaily[];
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

function buildCategorySeries(
  rows: MediaSnapshotCategoryDaily[],
  range: Range,
  nowMs: number,
): Series {
  const cutoffDays = rangeToCutoffDays(range);
  const monthly = shouldBucketMonthly(range);
  const cutoffMs = cutoffDays === null ? -Infinity : nowMs - cutoffDays * 86_400_000;

  const buckets = new Map<string, Map<string, number>>();
  const keys = new Set<string>();

  for (const row of rows) {
    const t = new Date(row.published_on + "T00:00:00Z").getTime();
    if (t < cutoffMs) continue;
    if (row.ai_count === 0) continue;
    const bucket = dateKey(row.published_on, monthly);
    keys.add(row.category_slug);
    if (!buckets.has(bucket)) buckets.set(bucket, new Map());
    const inner = buckets.get(bucket)!;
    inner.set(row.category_slug, (inner.get(row.category_slug) ?? 0) + row.ai_count);
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
  latest,
  indexHistory,
  categoryDaily,
  categories,
  anomalies,
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
    router.replace(qs ? `/media?${qs}` : "/media", { scroll: false });
  }

  const nowMs = useMemo(() => {
    let latestMs = 0;
    for (const row of indexHistory) {
      const t = new Date(row.date + "T00:00:00Z").getTime();
      if (t > latestMs) latestMs = t;
    }
    for (const row of categoryDaily) {
      const t = new Date(row.published_on + "T00:00:00Z").getTime();
      if (t > latestMs) latestMs = t;
    }
    return latestMs || 0;
  }, [indexHistory, categoryDaily]);

  const indexCutoffMs = useMemo(() => {
    const days = rangeToCutoffDays(range);
    return days === null ? null : nowMs - days * 86_400_000;
  }, [range, nowMs]);

  const indexMonthly = shouldBucketMonthly(range);

  const categorySeries = useMemo(
    () => buildCategorySeries(categoryDaily, range, nowMs),
    [categoryDaily, range, nowMs],
  );

  // Adapt media_categories into the TaxonomyCategory shape StackedArea expects.
  // colorForSkillSlug ignores the slug (uses index), and bandDescription pulls
  // definition_md when variant === "skill" — both work with our adapter.
  const taxonomyAdapter = useMemo<TaxonomyCategory[]>(
    () =>
      categories.map((c, i) => ({
        slug: c.slug,
        title: c.label_no,
        definition_md: c.description ?? "",
        sort_order: i,
      })),
    [categories],
  );

  const categoryListCutoffMs = nowMs - 30 * 86_400_000;

  return (
    <div
      className="
        flex flex-col
        sm:h-[calc(100svh-3.5rem)] sm:overflow-y-scroll
        sm:snap-y sm:snap-mandatory
        sm:scroll-pt-14
      "
    >
      <section className="snap-segment sm:snap-start sm:snap-always">
        <Hero latest={latest} />
      </section>

      <section className="snap-segment sm:snap-start sm:snap-always">
        <div className="flex h-full w-full flex-col gap-4 px-4 pt-6 pb-8 sm:px-8">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-medium tracking-tight sm:text-xl">
              Kibarometer-indeks over tid
            </h2>
            <RangeToggle value={range} onChange={onRangeChange} />
          </div>
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            7-dagers rullerende stemning fra 0 (bekymret) til 100 (begeistret).
            50 markerer balansert dekning.
          </p>
          <div className="min-h-0 flex-1">
            <IndexLine
              rows={indexHistory}
              cutoffMs={indexCutoffMs}
              monthly={indexMonthly}
            />
          </div>
        </div>
      </section>

      <section className="snap-segment sm:snap-start sm:snap-always">
        <div className="flex h-full w-full flex-col gap-4 px-4 pt-6 pb-8 sm:px-8">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-medium tracking-tight sm:text-xl">
              Volum per mediekategori
            </h2>
            <RangeToggle value={range} onChange={onRangeChange} />
          </div>
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            AI-artikler per dag, gruppert etter kategori. En artikkel kan høre
            til flere kategorier samtidig.
          </p>
          <div className="min-h-0 flex-1">
            <StackedArea
              series={categorySeries}
              taxonomy={taxonomyAdapter}
              variant="skill"
            />
          </div>
        </div>
      </section>

      <section className="snap-segment sm:snap-start sm:snap-always">
        <div className="flex h-full w-full flex-col gap-4 px-4 pt-6 pb-8 sm:px-8">
          <h2 className="text-lg font-medium tracking-tight sm:text-xl">
            Topp mediekategorier siste 30 dager
          </h2>
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            Rangert etter antall AI-artikler. Temperatur-kolonnen viser
            gjennomsnittlig holdning per kategori (negativ = bekymret, positiv
            = begeistret).
          </p>
          <div className="min-h-0 flex-1 overflow-auto">
            <CategoryList
              rows={categoryDaily}
              categories={categories}
              cutoffMs={categoryListCutoffMs}
            />
          </div>
        </div>
      </section>

      <section className="snap-segment sm:snap-start sm:snap-always">
        <div className="flex h-full w-full flex-col gap-4 px-4 pt-6 pb-8 sm:px-8">
          <h2 className="text-lg font-medium tracking-tight sm:text-xl">
            Anomalier — kategori-spiker
          </h2>
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            Dager hvor en kategori hadde uvanlig høyt volum mot 28-dagers
            rullerende baseline. Z-skår 2 eller mer, minst 5 artikler.
          </p>
          <div className="min-h-0 flex-1 overflow-auto">
            <AnomalyFeed rows={anomalies} categories={categories} />
          </div>
        </div>
      </section>
    </div>
  );
}
