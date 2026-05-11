"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import type {
  SnapshotDaily,
  SnapshotGeography,
  SnapshotHeadline,
  SnapshotKeyword,
  SnapshotSkillCategoryDaily,
  SnapshotTier2CoverageDaily,
  TaxonomyCategory,
} from "@/lib/supabase";

import {
  AIVolumeAreaChart,
  type AIShareBucket,
} from "@/app/(site)/_components/ai-volume-area-chart";
import { LlmCoverageBanner } from "@/app/(site)/_components/llm-coverage-banner";
import {
  PillarHero,
  PillarHeroEmpty,
  type PillarHeroStat,
} from "@/app/(site)/_components/pillar-hero";
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
  dateKey,
  parseRange,
  rangeCutoffMs,
} from "@/app/(site)/_lib/range";
import {
  fmtMomentumPct,
  fmtNumber,
} from "@/app/(site)/_lib/format-headline";

import { KeywordList } from "./keyword-list";
import { NorwayMap, type NorwayMapUnit } from "./norway-map";
import type { NorwayFylkePath } from "@/lib/norway-paths";

const NO_DATETIME = new Intl.DateTimeFormat("nb-NO", {
  day: "2-digit",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function fmtSharePct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${(n * 100).toFixed(1).replace(".", ",")} %`;
}

const MAP_UNIT: NorwayMapUnit = {
  ariaLabel: "Kart over AI-stillinger per fylke",
  itemNoun: "AI-stillinger",
  shareNoun: "AI-stillingene",
};

type Props = {
  headline: SnapshotHeadline | null;
  /** Per-day NAV-posting totals: ai_count + total_count, no enrichment
   *  filter — sums match snapshot_headline.ai_count_30d exactly. Drives
   *  segment 2's AI-share area chart. */
  snapshotDaily: SnapshotDaily[];
  skillCategoryDaily: SnapshotSkillCategoryDaily[];
  keywords: SnapshotKeyword[];
  geography: SnapshotGeography[];
  taxonomy: TaxonomyCategory[];
  tier2Coverage: SnapshotTier2CoverageDaily[];
  norwayPaths: readonly NorwayFylkePath[];
  norwayViewBox: string;
};

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
  const grain = bucketGrainForRange(range);
  const cutoffMs = rangeCutoffMs(range, nowMs);

  // Group: dateBucket -> (categoryKey -> count)
  const buckets = new Map<string, Map<string, number>>();
  const keys = new Set<string>();

  for (const row of rows) {
    const t = new Date(row.posted_on + "T00:00:00Z").getTime();
    if (t < cutoffMs) continue;
    const value = metric === "ai" ? row.ai_count : (row.total_count ?? 0);
    if (value === 0) continue;
    const bucket = dateKey(row.posted_on, grain);
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
  snapshotDaily,
  skillCategoryDaily,
  keywords,
  geography,
  taxonomy,
  tier2Coverage,
  norwayPaths,
  norwayViewBox,
}: Props) {
  const searchParams = useSearchParams();
  const initialRange = parseRange(searchParams.get("range"));
  const [range, setRange] = useState<Range>(initialRange);

  // Sync the URL via history.replaceState rather than Next.js router.replace
  // so the snap-scroll container's scroll position is never perturbed — the
  // router path can interact subtly with the segment layout and bounce the
  // user back to the hero on each click.
  function onRangeChange(next: Range) {
    setRange(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === "1m") params.delete("range");
    else params.set("range", next);
    const qs = params.toString();
    const url = qs ? `/jobbmarked?${qs}` : "/jobbmarked";
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", url);
    }
  }

  // Reference "now" derived from the data — the latest posted_on across the
  // daily snapshots. Anchored on snapshot_daily so the cutoff for segment 2
  // tracks the most recent NAV-posting date even when LLM Tier 2 is lagging
  // behind on snapshot_skill_category_daily. Avoids Date.now() during render
  // and gives stable cutoffs whether the page renders at 03:59 or 04:01.
  const nowMs = useMemo(() => {
    let latest = 0;
    for (const row of snapshotDaily) {
      const t = new Date(row.posted_on + "T00:00:00Z").getTime();
      if (t > latest) latest = t;
    }
    for (const row of skillCategoryDaily) {
      const t = new Date(row.posted_on + "T00:00:00Z").getTime();
      if (t > latest) latest = t;
    }
    return latest || 0;
  }, [snapshotDaily, skillCategoryDaily]);

  const skillSeries = useMemo(
    () => buildSeries(skillCategoryDaily, range, (r) => r.slug, "ai", nowMs),
    [skillCategoryDaily, range, nowMs],
  );

  // Per-bucket (ai_count, total_count) for segment 2's AI-share area chart.
  // Reads snapshot_daily directly so numerator and denominator share the same
  // predicate as snapshot_headline.ai_count_30d (no `category is not null`
  // filter). Bucket grain follows bucketGrainForRange (1m=day, rest=week).
  const aiShareBuckets = useMemo<AIShareBucket[]>(() => {
    const grain = bucketGrainForRange(range);
    const cutoffMs = rangeCutoffMs(range, nowMs);
    const buckets = new Map<string, { ai: number; total: number }>();
    for (const row of snapshotDaily) {
      const t = new Date(row.posted_on + "T00:00:00Z").getTime();
      if (t < cutoffMs) continue;
      const bucket = dateKey(row.posted_on, grain);
      const cur = buckets.get(bucket) ?? { ai: 0, total: 0 };
      cur.ai += row.ai_count;
      cur.total += row.total_count;
      buckets.set(bucket, cur);
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([date, v]) => ({ date, aiCount: v.ai, totalCount: v.total }));
  }, [snapshotDaily, range, nowMs]);

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
        {headline ? (
          (() => {
            const momentumPct =
              headline.ai_count_prev_30d > 0
                ? ((headline.ai_count_30d - headline.ai_count_prev_30d) /
                    headline.ai_count_prev_30d) *
                  100
                : null;
            const m = fmtMomentumPct(momentumPct);
            const stats: PillarHeroStat[] = [
              {
                label: "KI-jobber siste 30 dager",
                value: fmtNumber(headline.ai_count_30d),
              },
              {
                label: "Andel av alle stillinger",
                value: fmtSharePct(headline.ai_share_30d),
              },
              {
                label: "Siste 7 dager",
                value: fmtNumber(headline.ai_count_7d),
              },
            ];
            return (
              <PillarHero
                breadcrumb="Jobbmarked"
                title="Kunstig intelligens på norsk arbeidsmarked"
                description="Daglig oppdaterte tall fra NAVs stillingsfeed."
                big={{
                  value: m.display,
                  caption: "siste 30 dager vs. foregående 30",
                }}
                stats={stats}
                footer={
                  <>
                    Oppdatert{" "}
                    {NO_DATETIME.format(new Date(headline.computed_at))}
                  </>
                }
              />
            );
          })()
        ) : (
          <PillarHeroEmpty
            breadcrumb="Jobbmarked"
            message="Snapshots ikke regnet ennå."
          />
        )}
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
            Antall AI-relaterte stillinger publisert via NAVs feed, gruppert
            per dag eller uke. Hold over en stolpe for å se andelen av
            totalt utlyste stillinger.
          </p>
          <p className="max-w-[60ch] text-xs text-muted-foreground/80">
            Viser data fra og med 13. april 2026. Eldre NAV-stillinger gikk
            inaktive før vi rakk å hente fulltekst — klassifisering ut fra
            tittel alene ble for upålitelig til å publisere. Se{" "}
            <a
              href="/docs/jobbmarked"
              className="underline underline-offset-2 hover:text-foreground"
            >
              metode
            </a>{" "}
            for detaljer.
          </p>
          <div className="min-h-0 flex-1">
            <AIVolumeAreaChart buckets={aiShareBuckets} />
          </div>
        </div>
      </section>

      <section className="snap-segment sm:snap-start sm:snap-always">
        <div className="flex h-full w-full flex-col gap-4 px-4 pt-6 pb-8 sm:px-8">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-medium tracking-tight sm:text-xl">
              KI-jobber i kategorier
            </h2>
            <TimeRangeToggle value={range} onChange={onRangeChange} />
          </div>
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            Av AI-stillinger som er klassifisert av en språkmodell etter
            ferdighetskategori. Grafen viser fordelingen blant de
            klassifiserte stillingene — totalen følger derfor ikke
            nødvendigvis hovedtallet, og én stilling kan tilhøre flere
            kategorier (området summerer 100 %).
          </p>
          <LlmCoverageBanner
            rows={tier2Coverage}
            range={range}
            nowMs={nowMs}
          />
          <div className="min-h-0 flex-1">
            <StackedAreaChart
              series={skillSeries}
              taxonomy={taxonomy}
              variant="skill"
              normalize
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
