import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { sb } from "@/lib/supabase";
import type {
  BrregSnapshotDaily,
  BrregSnapshotHeadline,
  BrregSnapshotQuarterlyAiGrowth,
  MediaSnapshotIndex,
  SnapshotDaily,
  SnapshotHeadline,
} from "@/lib/supabase";

import { fmtMomentumPct, fmtNumber } from "./_lib/format-headline";
import {
  JOBBMARKED_DATA_CUTOFF,
  buildJobsMomentum,
} from "./_lib/data-cutoff";
import {
  formatQuarterLong,
  priorYearQuarter,
} from "./_lib/format-quarter";
import { OFFENTLIG_DATA_CUTOFF } from "./_lib/offentlig-cutoff";
import { percentile, type GaugeData } from "./_lib/gauge";
import { buildMediaCardModel } from "./_lib/media-card";
import {
  TemperaturCard,
  TemperaturCardEmpty,
} from "./_components/temperatur-card";

type OffentligHeadlineRow = {
  computed_for: string;
  computed_at: string;
  total_saker_ai_12m: number | null;
  debate_yoy_pct: number | null;
};
type OffentligMonthlyRow = { computed_for: string; ai_count: number };

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const revalidate = 60;

export const metadata: Metadata = {
  title: { absolute: "kibarometer" },
  description: "Open source barometer for Norges kunstig intelligens adopsjon.",
  alternates: { canonical: "/" },
  openGraph: {
    url: "/",
    title: "kibarometer",
    description: "Open source barometer for Norges kunstig intelligens adopsjon.",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "Tenki Labs",
      url: "https://tenki.no",
      logo: `${SITE_URL}/icon`,
      founder: {
        "@type": "Person",
        name: "Oscar Gangstad Westbye",
        url: "https://tenki.no",
      },
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: "Kibarometeret",
      inLanguage: "nb-NO",
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
  ],
};

const NO_LONG_DATE = new Intl.DateTimeFormat("nb-NO", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

function compute30dRollingSeries(
  daily: Array<{ date: string; ai: number }>,
): number[] {
  const asc = [...daily].sort((a, b) => a.date.localeCompare(b.date));
  const windows: number[] = [];
  let sum = 0;
  for (let i = 0; i < asc.length; i++) {
    sum += asc[i].ai;
    if (i >= 30) sum -= asc[i - 30].ai;
    if (i >= 29) windows.push(sum);
  }
  return windows;
}

function gaugeFromSeries(value: number, series: number[]): GaugeData | null {
  if (series.length < 5) return null;
  const sorted = [...series].sort((a, b) => a - b);
  return {
    value,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p10: percentile(sorted, 10),
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
  };
}

function levelDescriptor(value: number, gauge: GaugeData | null): string {
  if (!gauge) return "ukjent posisjon";
  if (value >= gauge.p90) return "høyt";
  if (value >= gauge.p50) return "over snitt";
  if (value >= gauge.p10) return "under snitt";
  return "lavt";
}

export default async function LandingPage() {
  type JobsDailyRow = Pick<SnapshotDaily, "posted_on" | "ai_count">;
  type BrregDailyRow = Pick<
    BrregSnapshotDaily,
    "registrert_dato" | "ai_relevant_count"
  >;

  const [
    jobsHeadline,
    jobsDaily,
    brregHeadline,
    brregDaily,
    brregYoy,
    mediaSeries,
    offentligHeadline,
    offentligMonthly,
    versionRow,
  ] = await Promise.all([
      sb<SnapshotHeadline[]>(
        "/snapshot_headline?order=computed_for.desc&limit=1",
      ).catch(() => null),
      // snapshot_daily filtered to JOBBMARKED_DATA_CUTOFF — pre-cutoff
      // rows are tagged title-only and undercount AI by ~10x; including
      // them in the gauge series + momentum computation publishes the
      // same artifact the /arbeidsmarked page already truncates away.
      // See app/(site)/_lib/data-cutoff.ts.
      sb<JobsDailyRow[]>(
        `/snapshot_daily?order=posted_on.desc&posted_on=gte.${JOBBMARKED_DATA_CUTOFF}&limit=150&select=posted_on,ai_count`,
      ).catch(() => null),
      sb<BrregSnapshotHeadline[]>(
        "/brreg_snapshot_headline?order=computed_for.desc&limit=1",
      ).catch(() => null),
      sb<BrregDailyRow[]>(
        "/brreg_snapshot_daily?order=registrert_dato.desc&limit=5000&select=registrert_dato,ai_relevant_count",
      ).catch(() => null),
      // Latest completed-quarter YoY row. The `not.is.null` filter
      // skips quarters without a prior-year comparison so we always
      // get a renderable number.
      sb<BrregSnapshotQuarterlyAiGrowth[]>(
        "/brreg_snapshot_quarterly_ai_growth?yoy_growth_pct=not.is.null&order=reg_quarter.desc&limit=1",
      ).catch(() => null),
      sb<MediaSnapshotIndex[]>(
        "/media_snapshot_index?order=date.desc&limit=90",
      ).catch(() => null),
      sb<OffentligHeadlineRow[]>(
        "/offentlig_snapshot_headline?order=computed_for.desc&limit=1&select=computed_for,computed_at,total_saker_ai_12m,debate_yoy_pct",
      ).catch(() => null),
      // Monthly storting saker, summed across categories per month. Used
      // for the 12-month rolling gauge series. Filtered to the offentlig
      // pillar's documented cutoff so pre-2019 backfill noise doesn't
      // skew the gauge percentiles.
      sb<OffentligMonthlyRow[]>(
        `/offentlig_snapshot_storting_monthly?order=computed_for.asc&computed_for=gte.${OFFENTLIG_DATA_CUTOFF}&select=computed_for,ai_count`,
      ).catch(() => null),
      sb<Array<{ title: string }>>(
        "/site_content?slug=eq.landing-version&select=title&limit=1",
      ).catch(() => null),
    ]);
  const versionLabel = versionRow?.[0]?.title ?? "Versjon 1.0";

  const jobs = jobsHeadline?.[0] ?? null;
  let jobsCard;
  if (jobs && jobsDaily && jobsDaily.length > 0) {
    const series = compute30dRollingSeries(
      jobsDaily.map((d) => ({ date: d.posted_on, ai: d.ai_count })),
    );
    const gauge = gaugeFromSeries(jobs.ai_count_30d, series);
    // Momentum pct is week-over-week until 2026-06-12, then auto-flips
    // to 30/30 — see app/(site)/_lib/data-cutoff.ts for why the 30/30
    // ratio from snapshot_headline is misleading right now.
    const momentum = buildJobsMomentum(jobs, jobsDaily);
    const m = fmtMomentumPct(momentum.pct);
    jobsCard = (
      <TemperaturCard
        href="/arbeidsmarked"
        pillarLabel="Arbeidsmarked"
        headlineValue={m.display}
        headlineCaption={momentum.caption}
        levelLabel={levelDescriptor(jobs.ai_count_30d, gauge)}
        levelCaption={`${fmtNumber(jobs.ai_count_30d)} ai-stillinger siste 30 dager`}
        gauge={gauge}
      />
    );
  } else {
    jobsCard = (
      <TemperaturCardEmpty href="/arbeidsmarked" pillarLabel="Arbeidsmarked" />
    );
  }

  const brreg = brregHeadline?.[0] ?? null;
  const yoyRow = brregYoy?.[0] ?? null;
  let oppstartCard;
  if (brreg && brregDaily && brregDaily.length > 0) {
    const byDate = new Map<string, number>();
    for (const r of brregDaily) {
      byDate.set(
        r.registrert_dato,
        (byDate.get(r.registrert_dato) ?? 0) + r.ai_relevant_count,
      );
    }
    const dailyAgg = Array.from(byDate.entries()).map(([date, ai]) => ({
      date,
      ai,
    }));
    const series = compute30dRollingSeries(dailyAgg);
    const gauge = gaugeFromSeries(brreg.ai_relevant_count_30d, series);
    // Year-on-year quarterly growth replaces the previous month-over-
    // month (siste 30 dager vs. foregående 30) headline. YoY is less
    // noisy and easier to cite — see brreg_snapshot_quarterly_ai_growth.
    const m = fmtMomentumPct(yoyRow?.yoy_growth_pct ?? null);
    const headlineCaption = yoyRow
      ? `${formatQuarterLong(yoyRow.reg_quarter)} vs. ${priorYearQuarter(yoyRow.reg_quarter)}`
      : "år/år-sammenligning ikke tilgjengelig ennå";
    oppstartCard = (
      <TemperaturCard
        href="/oppstart"
        pillarLabel="Oppstart"
        headlineValue={m.display}
        headlineCaption={headlineCaption}
        levelLabel={levelDescriptor(brreg.ai_relevant_count_30d, gauge)}
        levelCaption={`${fmtNumber(brreg.ai_relevant_count_30d)} ai-relevante selskaper siste 30 dager`}
        gauge={gauge}
      />
    );
  } else {
    oppstartCard = (
      <TemperaturCardEmpty href="/oppstart" pillarLabel="Oppstart" />
    );
  }

  const media = mediaSeries ?? [];
  const mediaLatest = media[0] ?? null;
  // buildMediaCardModel returns null when the latest media_snapshot_index
  // row is the no-signal sentinel (index 50, 0 AI articles) — i.e. the
  // classification pipeline has gone quiet — so we render the Empty card
  // instead of publishing a hard-coded-looking "50 / 100 · over snitt".
  const mediaModel = buildMediaCardModel(media);
  let mediaCard;
  if (mediaModel) {
    mediaCard = (
      <TemperaturCard
        href="/media"
        pillarLabel="Mediedekning"
        headlineValue={`${mediaModel.indexValue} / 100`}
        headlineCaption="kibarometer-indeks · siste 30 dager"
        levelLabel={levelDescriptor(mediaModel.indexValue, mediaModel.gauge)}
        levelCaption={`${fmtNumber(mediaModel.aiArticleCount7d)} ai-artikler siste 7 dager`}
        gauge={mediaModel.gauge}
      />
    );
  } else {
    mediaCard = (
      <TemperaturCardEmpty href="/media" pillarLabel="Mediedekning" />
    );
  }

  const off = offentligHeadline?.[0] ?? null;
  let offentligCard;
  if (off && offentligMonthly && offentligMonthly.length >= 12) {
    // Sum across categories per month so the gauge series matches the
    // headline's "total saker AI" semantics (not per-category).
    const byMonth = new Map<string, number>();
    for (const r of offentligMonthly) {
      byMonth.set(
        r.computed_for,
        (byMonth.get(r.computed_for) ?? 0) + r.ai_count,
      );
    }
    const monthly = Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v);
    // 12-month rolling sum so the gauge value (total_saker_ai_12m) is
    // dimensionally comparable to the series percentiles.
    const series: number[] = [];
    let sum = 0;
    for (let i = 0; i < monthly.length; i++) {
      sum += monthly[i];
      if (i >= 12) sum -= monthly[i - 12];
      if (i >= 11) series.push(sum);
    }
    const currentValue =
      off.total_saker_ai_12m ?? series[series.length - 1] ?? 0;
    const gauge = gaugeFromSeries(currentValue, series);
    const m = fmtMomentumPct(off.debate_yoy_pct);
    offentligCard = (
      <TemperaturCard
        href="/offentlig"
        pillarLabel="Offentlig sektor"
        headlineValue={m.display}
        headlineCaption="siste 12 mnd vs. forrige 12 mnd"
        levelLabel={levelDescriptor(currentValue, gauge)}
        levelCaption={`${fmtNumber(currentValue)} ai-saker siste 12 mnd`}
        gauge={gauge}
      />
    );
  } else {
    offentligCard = (
      <TemperaturCardEmpty href="/offentlig" pillarLabel="Offentlig sektor" />
    );
  }

  const stampMs = [
    jobs?.computed_at,
    brreg?.computed_at,
    mediaLatest?.date ? `${mediaLatest.date}T00:00:00Z` : null,
    off?.computed_at,
  ]
    .filter((x): x is string => Boolean(x))
    .map((x) => new Date(x).getTime())
    .filter((x) => Number.isFinite(x));
  const lastUpdated =
    stampMs.length > 0
      ? NO_LONG_DATE.format(new Date(Math.max(...stampMs)))
      : null;

  return (
    <main className="mx-auto flex min-h-[calc(100svh-3.5rem)] w-full max-w-4xl flex-col justify-center gap-14 px-6 py-12 sm:py-20">
      <Alert variant="warning">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Under utvikling.</AlertTitle>
        <AlertDescription>
          Datapipelinene fyller fortsatt på historikk, og det kan være
          misvisende og manglende data mens vi finjusterer. Vi setter stor
          pris på tilbakemeldinger og bug-rapporter.{" "}
          <Link
            href="/om#kontakt"
            className="font-medium underline underline-offset-2"
          >
            Gi tilbakemelding →
          </Link>
        </AlertDescription>
      </Alert>

      <section className="text-center">
        <h1 className="mx-auto max-w-3xl text-4xl font-medium leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
          Open source kartlegging av kunstig intelligens i Norge.
        </h1>
        <p className="mx-auto mt-8 max-w-xl text-base text-muted-foreground sm:text-lg">
          Daglig oppdaterte tall fra Norges arbeidsmarked, selskapsstiftelser,
          mediedekning og offentlig sektor.
        </p>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {jobsCard}
        {oppstartCard}
        {mediaCard}
        {offentligCard}
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Link href="/om" className="docs-index-card">
          <span className="docs-index-card-title">Om kibarometer</span>
          <span className="docs-index-card-desc">
            Uavhengig dashbord drevet av Tenki Labs.
          </span>
          <span className="docs-index-card-arrow" aria-hidden="true">
            →
          </span>
        </Link>
        <Link href="/docs" className="docs-index-card">
          <span className="docs-index-card-title">Metodikk og data</span>
          <span className="docs-index-card-desc">
            Hvordan vi henter, klassifiserer og publiserer.
          </span>
          <span className="docs-index-card-arrow" aria-hidden="true">
            →
          </span>
        </Link>
      </section>

      <footer className="flex items-center justify-between gap-4 font-mono text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
        <span>{versionLabel}</span>
        {lastUpdated ? <span>Sist oppdatert {lastUpdated}</span> : null}
      </footer>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </main>
  );
}
