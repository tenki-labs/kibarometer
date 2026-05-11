"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import {
  StackedAreaChart,
  type Series,
} from "@/app/(site)/_components/stacked-area-chart";
import {
  TimeRangeToggle,
  type Range,
} from "@/app/(site)/_components/time-range-toggle";
import {
  bucketGrainForRange,
  coverageHorizonMs,
  dateKey,
  parseRange,
  rangeCutoffMs,
  type BucketGrain,
} from "@/app/(site)/_lib/range";
import type {
  MediaAnomalyDaily,
  MediaCategory,
  MediaSnapshotCategoryDaily,
  MediaSnapshotIndex,
  SnapshotTier2CoverageDaily,
  TaxonomyCategory,
} from "@/lib/supabase";

import { LlmCoverageBanner } from "@/app/(site)/_components/llm-coverage-banner";
import {
  PillarHero,
  PillarHeroEmpty,
  type PillarHeroStat,
} from "@/app/(site)/_components/pillar-hero";
import { fmtNumber } from "@/app/(site)/_lib/format-headline";

import { AnomalyFeed } from "./anomaly-feed";
import { CategoryTemperatureList } from "./category-temperature-list";
import { IndexLine } from "./index-line";
import { VolumeArea } from "./volume-area";

type TopCategory = { label: string; aiCount: number };

const NB = new Intl.NumberFormat("nb-NO");
const NO_LONG_DATE = new Intl.DateTimeFormat("nb-NO", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

function indexLabel(value: number): string {
  if (value >= 65) return "Begeistret tilt";
  if (value >= 55) return "Lett positiv";
  if (value >= 45) return "Balansert";
  if (value >= 35) return "Lett negativ";
  return "Bekymret tilt";
}

type Props = {
  latest: MediaSnapshotIndex | null;
  prior: MediaSnapshotIndex | null;
  indexHistory: MediaSnapshotIndex[];
  categoryDaily: MediaSnapshotCategoryDaily[];
  categories: MediaCategory[];
  anomalies: MediaAnomalyDaily[];
  tier2Coverage: SnapshotTier2CoverageDaily[];
};

function buildCategorySeries(
  rows: MediaSnapshotCategoryDaily[],
  cutoffMs: number,
  grain: BucketGrain,
): Series {
  const buckets = new Map<string, Map<string, number>>();
  const keys = new Set<string>();

  for (const row of rows) {
    const t = new Date(row.published_on + "T00:00:00Z").getTime();
    if (t < cutoffMs) continue;
    if (row.ai_count === 0) continue;
    const bucket = dateKey(row.published_on, grain);
    keys.add(row.category_slug);
    if (!buckets.has(bucket)) buckets.set(bucket, new Map());
    const inner = buckets.get(bucket)!;
    inner.set(
      row.category_slug,
      (inner.get(row.category_slug) ?? 0) + row.ai_count,
    );
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
  prior,
  indexHistory,
  categoryDaily,
  categories,
  anomalies,
  tier2Coverage,
}: Props) {
  const searchParams = useSearchParams();
  const initialRange = parseRange(searchParams.get("range"));
  const [range, setRange] = useState<Range>(initialRange);

  // Sync the URL via history.replaceState rather than Next.js router.replace
  // so the snap-scroll container's scroll position is never perturbed — the
  // router path can interact subtly with the segment layout and bounce the
  // user back to the hero on each click. Mirrors /arbeidsmarked's scroller.
  function onRangeChange(next: Range) {
    setRange(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === "1m") params.delete("range");
    else params.set("range", next);
    const qs = params.toString();
    const url = qs ? `/media?${qs}` : "/media";
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", url);
    }
  }

  // Reference "now" derived from the data — the latest published_on / index
  // date across the snapshots. Avoids Date.now() during render and gives
  // stable cutoffs whether the page renders at 03:59 or 04:01.
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

  // Earliest data point across both snapshot tables. Drives the
  // "data goes back to X" coverage banner only — grain selection is
  // independent (see bucketGrainForRange).
  const coverageMs = useMemo(() => {
    const a = coverageHorizonMs(indexHistory);
    const b = coverageHorizonMs(categoryDaily);
    return Math.min(a, b);
  }, [indexHistory, categoryDaily]);

  const coverageStart = useMemo(() => {
    if (!Number.isFinite(coverageMs)) return null;
    return new Date(coverageMs).toISOString().slice(0, 10);
  }, [coverageMs]);

  const coverageDays = useMemo(() => {
    if (!Number.isFinite(coverageMs) || nowMs === 0) return 0;
    return Math.max(
      0,
      Math.round((nowMs - coverageMs) / 86_400_000) + 1,
    );
  }, [coverageMs, nowMs]);

  const cutoffMs = useMemo(() => rangeCutoffMs(range, nowMs), [range, nowMs]);
  const grain = useMemo(() => bucketGrainForRange(range), [range]);
  const indexCutoffMs = cutoffMs === -Infinity ? null : cutoffMs;

  const categorySeries = useMemo(
    () => buildCategorySeries(categoryDaily, cutoffMs, grain),
    [categoryDaily, cutoffMs, grain],
  );

  // Adapt media_categories into the TaxonomyCategory shape StackedAreaChart
  // expects (bandDescription pulls definition_md for variant="skill").
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

  // Top category in the last 7 days against the data's reference "now". Ties
  // broken by alphabetical slug. Returns null when no AI articles in window.
  const topCategoryLast7d = useMemo<TopCategory | null>(() => {
    if (nowMs === 0) return null;
    const cutoff = nowMs - 7 * 86_400_000;
    const tally = new Map<string, number>();
    for (const row of categoryDaily) {
      const t = new Date(row.published_on + "T00:00:00Z").getTime();
      if (t < cutoff) continue;
      if (row.ai_count === 0) continue;
      tally.set(row.category_slug, (tally.get(row.category_slug) ?? 0) + row.ai_count);
    }
    if (tally.size === 0) return null;
    const labelBySlug = new Map(categories.map((c) => [c.slug, c.label_no]));
    let bestSlug: string | null = null;
    let bestCount = -1;
    for (const [slug, count] of tally) {
      if (
        count > bestCount ||
        (count === bestCount && bestSlug !== null && slug < bestSlug)
      ) {
        bestSlug = slug;
        bestCount = count;
      }
    }
    if (bestSlug === null) return null;
    return {
      label: labelBySlug.get(bestSlug) ?? bestSlug,
      aiCount: bestCount,
    };
  }, [categoryDaily, categories, nowMs]);

  // Pre-filter anomalies to the active range so we can hide the whole
  // section when there's nothing to show, instead of rendering a card-shaped
  // "ingen spiker" placeholder.
  const inRangeAnomalies = useMemo(() => {
    const cutoff = indexCutoffMs ?? -Infinity;
    return anomalies.filter(
      (r) => new Date(r.date + "T00:00:00Z").getTime() >= cutoff,
    );
  }, [anomalies, indexCutoffMs]);

  return (
    <div
      className="
        flex flex-col
        sm:h-[calc(100svh-3.5rem)] sm:overflow-y-scroll
        sm:snap-y sm:snap-mandatory
      "
    >
      <section className="snap-segment sm:snap-start sm:snap-always">
        {latest ? (
          (() => {
            const indexValue = latest.index_value;
            const priorIndex = prior?.index_value ?? null;
            const indexDelta =
              priorIndex !== null ? indexValue - priorIndex : null;
            const stats: PillarHeroStat[] = [
              {
                label: "AI-artikler siste 7 dager",
                value: fmtNumber(latest.ai_article_count_7d),
              },
              {
                label: "Toppkategori siste 7 dager",
                value: topCategoryLast7d?.label ?? "—",
                hint: topCategoryLast7d
                  ? `${NB.format(topCategoryLast7d.aiCount)} ${
                      topCategoryLast7d.aiCount === 1
                        ? "artikkel"
                        : "artikler"
                    }`
                  : "Ingen klassifiserte artikler siste 7 dager",
              },
              {
                label: "Endring vs forrige uke",
                value:
                  indexDelta !== null
                    ? `${indexDelta >= 0 ? "+" : ""}${indexDelta}`
                    : "—",
                hint: indexDelta !== null ? "indekspunkter" : undefined,
              },
            ];
            const coverageBanner = coverageStart
              ? `Data fra ${NO_LONG_DATE.format(
                  new Date(coverageStart + "T00:00:00Z"),
                )} — ${NB.format(coverageDays)} ${
                  coverageDays === 1 ? "dag" : "dager"
                } dekning`
              : "Ingen klassifiserte artikler ennå";
            return (
              <PillarHero
                breadcrumb="Mediedekning"
                title="Norsk medieklima for kunstig intelligens"
                description="Daglig kibarometer-indeks (0–100) over hvor positivt eller bekymret norske medier omtaler kunstig intelligens. Glattet over en 7-dagers rullerende periode."
                big={{
                  value: `${indexValue} / 100`,
                  caption: `Kibarometer-indeks · ${indexLabel(indexValue)}`,
                }}
                stats={stats}
                footer={coverageBanner}
              />
            );
          })()
        ) : (
          <PillarHeroEmpty
            breadcrumb="Mediedekning"
            message="Ingen klassifiserte artikler ennå."
          />
        )}
      </section>

      <section className="snap-segment sm:snap-start sm:snap-always">
        <div className="flex h-full w-full flex-col gap-4 px-4 pt-6 pb-8 sm:px-8">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-medium tracking-tight sm:text-xl">
              Kibarometer-indeks over tid
            </h2>
            <TimeRangeToggle value={range} onChange={onRangeChange} />
          </div>
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            7-dagers rullerende stemning fra 0 (bekymret) til 100
            (begeistret). Fargen følger temperaturen — blå nederst, rød
            øverst, balansert ved 50.
          </p>
          <div className="min-h-0 flex-1">
            <IndexLine
              rows={indexHistory}
              cutoffMs={indexCutoffMs}
              grain={grain}
            />
          </div>
        </div>
      </section>

      <section className="snap-segment sm:snap-start sm:snap-always">
        <div className="flex h-full w-full flex-col gap-4 px-4 pt-6 pb-8 sm:px-8">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-medium tracking-tight sm:text-xl">
              Andel per mediekategori
            </h2>
            <TimeRangeToggle value={range} onChange={onRangeChange} />
          </div>
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            Andel av AI-artikler per dag, fordelt på kategori. Hver
            tidsperiode summerer til 100 %. En artikkel kan høre til flere
            kategorier samtidig.
          </p>
          <LlmCoverageBanner
            rows={tier2Coverage}
            range={range}
            nowMs={nowMs}
          />
          <div className="min-h-0 flex-1">
            <StackedAreaChart
              series={categorySeries}
              taxonomy={taxonomyAdapter}
              variant="skill"
              normalize
            />
          </div>
        </div>
      </section>

      <section className="snap-segment sm:snap-start sm:snap-always">
        <div className="flex h-full w-full flex-col gap-4 px-4 pt-6 pb-8 sm:px-8">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-medium tracking-tight sm:text-xl">
              Temperatur per kategori
            </h2>
            <TimeRangeToggle value={range} onChange={onRangeChange} />
          </div>
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            Hver kategori med snitt-temperatur og utvikling over perioden.
            Sortert etter antall AI-artikler. Negativ = bekymret, positiv =
            begeistret.
          </p>
          <div className="min-h-0 flex-1 overflow-auto">
            <CategoryTemperatureList
              rows={categoryDaily}
              categories={categories}
              cutoffMs={indexCutoffMs}
              grain={grain}
            />
          </div>
        </div>
      </section>

      <section className="snap-segment sm:snap-start sm:snap-always">
        <div className="flex h-full w-full flex-col gap-4 px-4 pt-6 pb-8 sm:px-8">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-medium tracking-tight sm:text-xl">
              Antall AI-artikler per dag
            </h2>
            <TimeRangeToggle value={range} onChange={onRangeChange} />
          </div>
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            Daglig totalvolum av AI-relaterte artikler på tvers av alle
            kilder.
          </p>
          <div className="min-h-0 flex-1">
            <VolumeArea
              rows={categoryDaily}
              cutoffMs={indexCutoffMs}
              grain={grain}
            />
          </div>
        </div>
      </section>

      {inRangeAnomalies.length > 0 ? (
        <section className="snap-segment sm:snap-start sm:snap-always">
          <div className="flex h-full w-full flex-col gap-4 px-4 pt-6 pb-8 sm:px-8">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-lg font-medium tracking-tight sm:text-xl">
                Anomalier — kategori-spiker
              </h2>
              <TimeRangeToggle value={range} onChange={onRangeChange} />
            </div>
            <p className="max-w-[60ch] text-sm text-muted-foreground">
              Dager hvor en kategori hadde uvanlig høyt volum mot 28-dagers
              rullerende baseline. Z-skår 2 eller mer, minst 5 artikler.
            </p>
            <div className="min-h-0 flex-1 overflow-auto">
              <AnomalyFeed
                rows={inRangeAnomalies}
                categoryDaily={categoryDaily}
                categories={categories}
                cutoffMs={indexCutoffMs}
              />
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
