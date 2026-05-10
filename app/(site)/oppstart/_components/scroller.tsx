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
  bucketGrainForRange,
  dateKey,
  parseRange,
  rangeCutoffMs,
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
          <FootnoteRow oppdatert={oppdatert} showMethodology />
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
          <FootnoteRow oppdatert={oppdatert} showMethodology />
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
          <FootnoteRow oppdatert={oppdatert} />
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
}: {
  oppdatert: string | null;
  showMethodology?: boolean;
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
    </div>
  );
}
