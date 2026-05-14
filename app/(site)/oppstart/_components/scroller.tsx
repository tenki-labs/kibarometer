"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  AIVolumeAreaChart,
  type AIShareBucket,
} from "@/app/(site)/_components/ai-volume-area-chart";
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
  unavailableRanges,
} from "@/app/(site)/_lib/range";
import {
  formatQuarterLong,
  priorYearQuarter,
} from "@/app/(site)/_lib/format-quarter";
import {
  NorwayMap,
  type NorwayMapUnit,
} from "@/app/(site)/arbeidsmarked/_components/norway-map";
import type { NorwayFylkePath } from "@/lib/norway-paths";
import type {
  BrregSnapshotDaily,
  BrregSnapshotFinancialsCohort,
  BrregSnapshotFinancialsYearly,
  BrregSnapshotFounderAgeMonthly,
  BrregSnapshotGeography,
  BrregSnapshotHeadline,
  BrregSnapshotKeyword,
  BrregSnapshotQuarterlyAiGrowth,
  SnapshotGeography,
  TaxonomyCategory,
} from "@/lib/supabase";

import {
  PillarHero,
  PillarHeroEmpty,
  type PillarHeroStat,
} from "@/app/(site)/_components/pillar-hero";
import {
  fmtMomentumPct,
  fmtNumber,
} from "@/app/(site)/_lib/format-headline";

import { FinancialsCohortCards } from "./financials-cohort-cards";
import { FinancialsGrowth } from "./financials-growth";
import { FinancialsPareto } from "./financials-pareto";
import { FounderAgeLines } from "./founder-age-lines";
import { KeywordList } from "./keyword-list";
import { QuarterlyYoyChart } from "./quarterly-yoy-chart";

const NB = new Intl.NumberFormat("nb-NO");
const NO_DATETIME = new Intl.DateTimeFormat("nb-NO", {
  day: "2-digit",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

// Snapshot is refreshed nightly (kiba-fetcher cron). Anything older than 48h
// indicates the cron has missed at least two runs — flag it visually.
const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

function fmtSharePct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined) return "—";
  return `${(n * 100).toFixed(digits).replace(".", ",")} %`;
}

const MAP_UNIT: NorwayMapUnit = {
  ariaLabel: "Kart over nye AI-relevante foretak per fylke",
  itemNoun: "AI-relevante foretak",
  shareNoun: "AI-foretakene",
};

// Topp kategorier visibility thresholds. A category survives only if it has
// at least MIN_CATEGORY_COUNT AI-relevant foretak in the active window AND
// represents at least MIN_CATEGORY_SHARE of the window's AI total. Bands
// thinner than this make the legend honest at the cost of dropping noisy
// long-tail categories.
const MIN_CATEGORY_COUNT = 5;
const MIN_CATEGORY_SHARE = 0.005;

// brreg_snapshot_daily coalesces unmapped NACE codes to 'annet' (see
// 0047_brreg_2018_floor.sql). We never want it as a named stack band — it's
// a catch-all, not a real category. Its companies still flow into the
// residual "Andre" band so the 100% stack stays honest.
const HIDDEN_CATEGORY_SLUGS = new Set(["annet"]);

// Synthetic key for the residual band. Carries the AI count from 'annet' and
// the below-threshold long tail so the normalised stack actually equals 100 %
// of the bucket's AI total (rather than 100 % of the *visible* categories,
// which would silently inflate every survivor's apparent share). Reserved
// slug — must not collide with any nace_category_slug.
const RESIDUAL_KEY = "__andre__";
const RESIDUAL_LABEL = "Andre";
const RESIDUAL_DEFINITION =
  "Mindre kategorier under terskelen pluss foretak uten klar NACE-kode (samlebåsen «annet»).";

const NO_DATETIME_SHORT = new Intl.DateTimeFormat("nb-NO", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});

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
  financialsYearly: BrregSnapshotFinancialsYearly[];
  financialsCohort: BrregSnapshotFinancialsCohort[];
  quarterlyAiGrowth: BrregSnapshotQuarterlyAiGrowth[];
  norwayPaths: readonly NorwayFylkePath[];
  norwayViewBox: string;
};

function buildAiShareBuckets(
  rows: BrregSnapshotDaily[],
  range: Range,
  nowMs: number,
): AIShareBucket[] {
  const cutoffMs = rangeCutoffMs(range, nowMs);
  const grain = bucketGrainForRange(range);
  const buckets = new Map<string, { ai: number; total: number }>();
  for (const row of rows) {
    const t = new Date(row.registrert_dato + "T00:00:00Z").getTime();
    if (t < cutoffMs) continue;
    const key = dateKey(row.registrert_dato, grain);
    const cur = buckets.get(key) ?? { ai: 0, total: 0 };
    cur.ai += row.ai_relevant_count;
    cur.total += row.count;
    buckets.set(key, cur);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, aiCount: v.ai, totalCount: v.total }));
}

// Build a Series of category mix among AI-relevant new companies. A category
// survives the legend only if its window total clears MIN_CATEGORY_COUNT and
// MIN_CATEGORY_SHARE, and it is not in HIDDEN_CATEGORY_SLUGS. Everything else
// is folded into a synthetic RESIDUAL_KEY band so the 100 % stack reflects
// the bucket's true AI total — without a residual the normalised stack
// silently inflates each surviving category's apparent share.
function buildCategoryMixSeries(
  rows: BrregSnapshotDaily[],
  range: Range,
  nowMs: number,
): Series {
  const cutoffMs = rangeCutoffMs(range, nowMs);
  const grain = bucketGrainForRange(range);
  const buckets = new Map<string, Map<string, number>>();
  const bucketTotalAi = new Map<string, number>();
  const slugTotals = new Map<string, number>();

  for (const row of rows) {
    const t = new Date(row.registrert_dato + "T00:00:00Z").getTime();
    if (t < cutoffMs) continue;
    if (row.ai_relevant_count === 0) continue;
    const bucket = dateKey(row.registrert_dato, grain);
    // Every AI-relevant row counts toward the bucket total — this is the
    // denominator the 100 % stack must respect (incl. 'annet' + long tail).
    bucketTotalAi.set(
      bucket,
      (bucketTotalAi.get(bucket) ?? 0) + row.ai_relevant_count,
    );
    // Hidden slugs (e.g. 'annet') stay out of named bands but still flow
    // into the residual via bucketTotalAi above.
    if (HIDDEN_CATEGORY_SLUGS.has(row.nace_category_slug)) continue;
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

  const windowAiTotal = [...slugTotals.values()].reduce((a, n) => a + n, 0);
  const liveKeys = [...slugTotals.entries()]
    .filter(([, n]) => {
      if (n < MIN_CATEGORY_COUNT) return false;
      if (windowAiTotal > 0 && n / windowAiTotal < MIN_CATEGORY_SHARE)
        return false;
      return true;
    })
    .map(([k]) => k);

  // Dev-only invariant check: the filter above is the source of truth, so
  // if a survivor falls below either gate we want to hear about it. (The
  // previous version checked `<= 0`, which the count gate already rules
  // out — this rewrite catches a real regression instead of asserting an
  // impossibility.)
  if (process.env.NODE_ENV !== "production") {
    for (const k of liveKeys) {
      const n = slugTotals.get(k) ?? 0;
      if (n < MIN_CATEGORY_COUNT) {
        console.error(
          `buildCategoryMixSeries: ${k} survived with n=${n} (< MIN_CATEGORY_COUNT=${MIN_CATEGORY_COUNT})`,
        );
      }
      if (windowAiTotal > 0 && n / windowAiTotal < MIN_CATEGORY_SHARE) {
        console.error(
          `buildCategoryMixSeries: ${k} survived with share=${(n / windowAiTotal).toFixed(4)} (< MIN_CATEGORY_SHARE=${MIN_CATEGORY_SHARE})`,
        );
      }
    }
  }

  // Compute the residual per bucket = bucket AI total − sum of visible bands.
  // Adds the synthetic RESIDUAL_KEY band only when at least one bucket has
  // a positive residual; otherwise the chart stays unchanged.
  let residualUsed = false;
  for (const [date, total] of bucketTotalAi) {
    const inner = buckets.get(date);
    let visible = 0;
    if (inner) for (const k of liveKeys) visible += inner.get(k) ?? 0;
    const andre = total - visible;
    if (andre > 0) {
      if (!inner) buckets.set(date, new Map([[RESIDUAL_KEY, andre]]));
      else inner.set(RESIDUAL_KEY, andre);
      residualUsed = true;
    }
  }
  if (residualUsed) liveKeys.push(RESIDUAL_KEY);

  // Use bucketTotalAi as the date set so an "Andre-only" bucket (e.g. only
  // 'annet' rows) still appears on the x-axis.
  const sortedDates = [...bucketTotalAi.keys()].sort();
  return {
    dates: sortedDates,
    keys: liveKeys,
    values: sortedDates.map((d) => {
      const inner = buckets.get(d);
      return liveKeys.map((k) => inner?.get(k) ?? 0);
    }),
  };
}

function formatComputedAt(iso: string | undefined): string | null {
  if (!iso) return null;
  return NO_DATETIME_SHORT.format(new Date(iso));
}

export function Scroller({
  headline,
  daily,
  founderAgeMonthly,
  keywords,
  geography,
  categories,
  financialsYearly,
  financialsCohort,
  quarterlyAiGrowth,
  norwayPaths,
  norwayViewBox,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialRange = parseRange(searchParams.get("range"));
  const [range, setRange] = useState<Range>(initialRange);

  // Stale check captured once at mount via useState lazy init — Date.now()
  // is impure and react-hooks/purity bans it inside render. The 48h
  // threshold isn't time-critical enough to need a live timer.
  const [heroStale] = useState(() => {
    if (!headline) return false;
    const ms = new Date(headline.computed_at).getTime();
    if (!Number.isFinite(ms)) return false;
    return Date.now() - ms > STALE_AFTER_MS;
  });

  // Sync the URL via router.replace with { scroll: false } so the snap-scroll
  // container's scroll position is never perturbed. We previously called
  // window.history.replaceState directly here, but that desynced Next.js's
  // App Router state from the actual URL — subsequent <Link> clicks could
  // serve stale prefetched RSC payloads, manifesting as empty charts on the
  // next pillar page until a hard refresh. Mirrors /arbeidsmarked.
  function onRangeChange(next: Range) {
    setRange(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === "1m") params.delete("range");
    else params.set("range", next);
    const qs = params.toString();
    const url = qs ? `/oppstart?${qs}` : "/oppstart";
    router.replace(url, { scroll: false });
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

  // Earliest data point in `daily` (registrert_dato). BRREG uses a
  // different date column than coverageHorizonMs knows about, so we
  // compute it inline. Drives the disabled state for the two daily-
  // backed toggles (volume + categories).
  const dailyCoverageMs = useMemo(() => {
    let earliest = Infinity;
    for (const row of daily) {
      const t = new Date(row.registrert_dato + "T00:00:00Z").getTime();
      if (Number.isFinite(t) && t < earliest) earliest = t;
    }
    return earliest;
  }, [daily]);

  // Founder-age data is monthly (reg_month YYYY-MM-01) and extends
  // further back than `daily` — using daily's horizon here would
  // over-disable. Pin "first of the month" with -01.
  const founderAgeCoverageMs = useMemo(() => {
    let earliest = Infinity;
    for (const row of founderAgeMonthly) {
      const t = new Date(row.reg_month + "T00:00:00Z").getTime();
      if (Number.isFinite(t) && t < earliest) earliest = t;
    }
    return earliest;
  }, [founderAgeMonthly]);

  const disabledRangesDaily = useMemo(
    () => unavailableRanges(dailyCoverageMs, nowMs),
    [dailyCoverageMs, nowMs],
  );

  const disabledRangesFounder = useMemo(
    () => unavailableRanges(founderAgeCoverageMs, nowMs),
    [founderAgeCoverageMs, nowMs],
  );

  const aiShareBuckets = useMemo(
    () => buildAiShareBuckets(daily, range, nowMs),
    [daily, range, nowMs],
  );

  const categoryMixSeries = useMemo(
    () => buildCategoryMixSeries(daily, range, nowMs),
    [daily, range, nowMs],
  );

  // taxonomyAdapter feeds StackedAreaChart's "skill" variant for label,
  // tooltip definition, and band ordering. The synthetic "Andre" entry sits
  // at the end of the sort order so the residual band lands last (least
  // visually prominent), and its definition surfaces in the tooltip on hover
  // so users understand what's lumped together.
  const taxonomyAdapter = useMemo<TaxonomyCategory[]>(
    () => [
      ...categories.map((c, i) => ({
        slug: c.slug,
        title: c.label_no,
        definition_md: c.label_no,
        sort_order: i,
      })),
      {
        slug: RESIDUAL_KEY,
        title: RESIDUAL_LABEL,
        definition_md: RESIDUAL_DEFINITION,
        sort_order: 9999,
      },
    ],
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

  const oppdatert = formatComputedAt(headline?.computed_at);

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
            // Replaces the previous MoM (30d vs prior 30d) hero number.
            // YoY against the same quarter one year prior is less noisy
            // and easier to cite in coverage.
            const latestYoy =
              [...quarterlyAiGrowth]
                .reverse()
                .find((r) => r.yoy_growth_pct !== null) ?? null;
            const m = fmtMomentumPct(latestYoy?.yoy_growth_pct ?? null);
            const heroCaption = latestYoy
              ? `${formatQuarterLong(latestYoy.reg_quarter)} vs. ${priorYearQuarter(
                  latestYoy.reg_quarter,
                )}`
              : "år/år-sammenligning ikke tilgjengelig ennå";
            const stats: PillarHeroStat[] = [
              {
                label: "AI-relevante foretak 30d",
                value: fmtNumber(headline.ai_relevant_count_30d),
              },
              {
                label: "Median aksjekap. KI-AS",
                value:
                  headline.aksjekapital_median_ai_relevant_as_30d != null
                    ? `${NB.format(headline.aksjekapital_median_ai_relevant_as_30d)} kr`
                    : "—",
              },
              {
                label: "AS-andel av KI-rel.",
                value: fmtSharePct(headline.as_share_of_ai_relevant_30d),
              },
            ];
            return (
              <PillarHero
                breadcrumb="Oppstart"
                title="Kunstig intelligens i norsk selskapsstiftelse"
                description="Daglig oppdaterte tall fra Brønnøysundregistrene over nyregistrerte foretak knyttet til kunstig intelligens."
                big={{
                  value: m.display,
                  caption: heroCaption,
                }}
                stats={stats}
                footer={
                  <>
                    Oppdatert{" "}
                    <span
                      className={
                        heroStale ? "text-amber-600 dark:text-amber-400" : undefined
                      }
                    >
                      {NO_DATETIME.format(new Date(headline.computed_at))}
                    </span>
                  </>
                }
              />
            );
          })()
        ) : (
          <PillarHeroEmpty
            breadcrumb="Oppstart"
            message="Snapshots ikke regnet ennå."
          />
        )}
      </section>

      <section className="snap-segment sm:snap-start sm:snap-always">
        <div className="flex h-full w-full flex-col gap-4 px-4 pt-6 pb-8 sm:px-8">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-medium tracking-tight sm:text-xl">
              Nye AI-relevante foretak
            </h2>
            <TimeRangeToggle
              value={range}
              onChange={onRangeChange}
              disabledValues={disabledRangesDaily}
            />
          </div>
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            Antall nyregistrerte AI-relevante foretak fra Brønnøysund­
            registrene, gruppert per dag, uke eller måned. Hold over en
            stolpe for å se andelen av alle nyregistreringer.
          </p>
          <div className="min-h-0 flex-1">
            <AIVolumeAreaChart buckets={aiShareBuckets} unitLabel="foretak" />
          </div>
          <FootnoteRow oppdatert={oppdatert} showMethodology />
        </div>
      </section>

      <section className="snap-segment sm:snap-start sm:snap-always">
        <div className="flex h-full w-full flex-col gap-4 px-4 pt-6 pb-8 sm:px-8">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-medium tracking-tight sm:text-xl">
              Kvartalsvis vekst — KI-relevante foretak (år/år)
            </h2>
          </div>
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            Prosentvis endring i antall nyregistrerte AI-relevante foretak
            sammenlignet med samme kvartal året før. Bare ferdige kvartaler
            telles — inneværende kvartal vises først når det er over. Tomme
            kvartaler uten år-tidligere-data skjules.
          </p>
          <div className="min-h-0 flex-1">
            <QuarterlyYoyChart rows={quarterlyAiGrowth} />
          </div>
          <FootnoteRow oppdatert={oppdatert} showMethodology />
        </div>
      </section>

      <section className="snap-segment sm:snap-start sm:snap-always">
        <div className="flex h-full w-full flex-col gap-4 px-4 pt-6 pb-8 sm:px-8">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-medium tracking-tight sm:text-xl">
              Topp kategorier — etter AI-andel
            </h2>
            <TimeRangeToggle
              value={range}
              onChange={onRangeChange}
              disabledValues={disabledRangesDaily}
            />
          </div>
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            Næringskategorier blant AI-relevante nyregistreringer, normalisert
            til 100 % per periode. Kategorier med færre enn {MIN_CATEGORY_COUNT}{" "}
            foretak eller under {(MIN_CATEGORY_SHARE * 100).toString().replace(".", ",")}{" "}
            % av perioden samles i «{RESIDUAL_LABEL}», sammen med samlebåsen «annet» fra NACE.
          </p>
          <div className="min-h-0 flex-1">
            <StackedAreaChart
              series={categoryMixSeries}
              taxonomy={taxonomyAdapter}
              variant="skill"
              normalize
            />
          </div>
          <FootnoteRow oppdatert={oppdatert} showMethodology />
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
          <FootnoteRow oppdatert={oppdatert} />
        </div>
      </section>

      <section className="snap-segment sm:snap-start sm:snap-always">
        <div className="flex h-full w-full flex-col gap-4 px-4 pt-6 pb-8 sm:px-8">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-medium tracking-tight sm:text-xl">
              Gjennomsnittlig alder ved registrering — AI vs ikke-AI
            </h2>
            <TimeRangeToggle
              value={range}
              onChange={onRangeChange}
              disabledValues={disabledRangesFounder}
            />
          </div>
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            Gjennomsnittlig alder på yngste registrerte rolleinnehaver ved
            registreringstidspunktet, per måned. To linjer sammenligner
            AI-relevante foretak mot resten. Tooltip viser standardavvik
            og utvalg.
          </p>
          <div className="min-h-0 flex-1">
            <FounderAgeLines
              rows={founderAgeMonthly}
              range={range}
              nowMs={nowMs}
            />
          </div>
          <FootnoteRow oppdatert={oppdatert} showMethodology />
        </div>
      </section>

      <section className="snap-segment sm:snap-start sm:snap-always">
        <div className="flex h-full w-full flex-col gap-4 px-4 pt-6 pb-8 sm:px-8">
          <h2 className="text-lg font-medium tracking-tight sm:text-xl">
            Geografi — nye foretak per fylke
          </h2>
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            Geografisk fordeling av AI-relevante nyregistreringer siste 30
            dager. Prosentene er fylkets andel av landets AI-foretak og
            summerer til 100 %.
          </p>
          <div className="min-h-0 flex-1">
            <NorwayMap
              geography={geoForMap}
              paths={norwayPaths}
              viewBox={norwayViewBox}
              unit={MAP_UNIT}
            />
          </div>
          <FootnoteRow oppdatert={oppdatert} />
        </div>
      </section>

      <section className="snap-segment sm:snap-start sm:snap-always">
        <div className="flex h-full w-full flex-col gap-4 px-4 pt-6 pb-8 sm:px-8">
          <h2 className="text-lg font-medium tracking-tight sm:text-xl">
            Variansen i AI-økonomien
          </h2>
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            Hvor konsentrert er omsetningen blant AI-relevante foretak?
            Lorenz-kurven viser kumulativ andel selskaper (sortert lavest
            til høyest omsetning) mot kumulativ andel av sektorens
            omsetning. 45°-linjen tilsvarer perfekt likhet — jo lengre
            kurven faller fra den, jo mer ulik fordeling.
          </p>
          <div className="min-h-0 flex-1">
            <FinancialsPareto rows={financialsYearly} />
          </div>
          <FootnoteRow oppdatert={oppdatert} financialsSource />
        </div>
      </section>

      <section className="snap-segment sm:snap-start sm:snap-always">
        <div className="flex h-full w-full flex-col gap-4 px-4 pt-6 pb-8 sm:px-8">
          <h2 className="text-lg font-medium tracking-tight sm:text-xl">
            Omsetning over tid — AI vs basislinje
          </h2>
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            Sum sum_driftsinntekter per regnskapsår, indeksert til 100 i
            basisåret. Skraffert område markerer det siste året — det er
            foreløpig fordi årsregnskap leveres Jul–Sep året etter
            rapporteringsåret.
          </p>
          <div className="min-h-0 flex-1">
            <FinancialsGrowth rows={financialsYearly} />
          </div>
          <FootnoteRow oppdatert={oppdatert} financialsSource />
        </div>
      </section>

      <section className="snap-segment sm:snap-start sm:snap-always">
        <div className="flex h-full w-full flex-col gap-4 px-4 pt-6 pb-8 sm:px-8">
          <h2 className="text-lg font-medium tracking-tight sm:text-xl">
            Hvor mange overlever?
          </h2>
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            Hver årgang AI-selskap (fra Brønnøysundregistrene)
            sammenlignet med basislinjen ved siste hele rapporteringsår.
            Kortets ramme er grønn når årgangen overlever bedre enn
            basislinjen, rød når den overlever dårligere.
          </p>
          <div className="min-h-0 flex-1">
            <FinancialsCohortCards rows={financialsCohort} />
          </div>
          <FootnoteRow oppdatert={oppdatert} financialsSource />
        </div>
      </section>
    </div>
  );
}

// Small footer row under each chart: data freshness on the left, optional
// methodology link on the right. Spelling out what "AI-relevant" means in
// one sentence keeps the keyword-only signal honest without cluttering the
// chart copy.
function FootnoteRow({
  oppdatert,
  showMethodology,
  financialsSource,
}: {
  oppdatert: string | null;
  showMethodology?: boolean;
  financialsSource?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[0.7rem] text-muted-foreground">
      <span>{oppdatert ? <>Oppdatert {oppdatert}</> : null}</span>
      {showMethodology ? (
        <span>
          AI-relevant = treff på kuraterte nøkkelord i firmanavn eller
          aktivitet ved registrering.{" "}
          <a className="underline underline-offset-2" href="/docs/oppstart">
            Mer om metode
          </a>
          .
        </span>
      ) : null}
      {financialsSource ? (
        <span>
          Kilde: Regnskapsregisteret (NLOD 2.0). Små AS under
          regnskapsplikt og ENK leverer ikke — kjent dekningssvakhet.{" "}
          <a className="underline underline-offset-2" href="/docs/oppstart">
            Mer om metode
          </a>
          .
        </span>
      ) : null}
    </div>
  );
}
