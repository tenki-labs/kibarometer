import type { Metadata } from "next";
import Link from "next/link";

import { sb } from "@/lib/supabase";
import type {
  BrregSnapshotDaily,
  BrregSnapshotHeadline,
  MediaSnapshotIndex,
  SnapshotDaily,
  SnapshotHeadline,
} from "@/lib/supabase";

import { fmtMomentumPct, fmtNumber } from "./_lib/format-headline";
import {
  TemperaturCard,
  TemperaturCardEmpty,
} from "./_components/temperatur-card";

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

type GaugeData = {
  value: number;
  min: number;
  max: number;
  p10: number;
  p50: number;
  p90: number;
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

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const idx = (sortedAsc.length - 1) * (p / 100);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
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

  const [jobsHeadline, jobsDaily, brregHeadline, brregDaily, mediaSeries] =
    await Promise.all([
      sb<SnapshotHeadline[]>(
        "/snapshot_headline?order=computed_for.desc&limit=1",
      ).catch(() => null),
      sb<JobsDailyRow[]>(
        "/snapshot_daily?order=posted_on.desc&limit=150&select=posted_on,ai_count",
      ).catch(() => null),
      sb<BrregSnapshotHeadline[]>(
        "/brreg_snapshot_headline?order=computed_for.desc&limit=1",
      ).catch(() => null),
      sb<BrregDailyRow[]>(
        "/brreg_snapshot_daily?order=registrert_dato.desc&limit=5000&select=registrert_dato,ai_relevant_count",
      ).catch(() => null),
      sb<MediaSnapshotIndex[]>(
        "/media_snapshot_index?order=date.desc&limit=90",
      ).catch(() => null),
    ]);

  const jobs = jobsHeadline?.[0] ?? null;
  let jobsCard;
  if (jobs && jobsDaily && jobsDaily.length > 0) {
    const series = compute30dRollingSeries(
      jobsDaily.map((d) => ({ date: d.posted_on, ai: d.ai_count })),
    );
    const gauge = gaugeFromSeries(jobs.ai_count_30d, series);
    const momentumPct =
      jobs.ai_count_prev_30d > 0
        ? ((jobs.ai_count_30d - jobs.ai_count_prev_30d) /
            jobs.ai_count_prev_30d) *
          100
        : null;
    const m = fmtMomentumPct(momentumPct);
    jobsCard = (
      <TemperaturCard
        href="/jobbmarked"
        pillarLabel="Jobbmarked"
        headlineValue={m.display}
        headlineCaption="siste 30 dager vs. foregående 30"
        levelLabel={levelDescriptor(jobs.ai_count_30d, gauge)}
        levelCaption={`${fmtNumber(jobs.ai_count_30d)} ai-stillinger siste 30 dager`}
        gauge={gauge}
      />
    );
  } else {
    jobsCard = (
      <TemperaturCardEmpty href="/jobbmarked" pillarLabel="Jobbmarked" />
    );
  }

  const brreg = brregHeadline?.[0] ?? null;
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
    const momentumPct =
      brreg.ai_relevant_mom_growth !== null
        ? brreg.ai_relevant_mom_growth * 100
        : null;
    const m = fmtMomentumPct(momentumPct);
    oppstartCard = (
      <TemperaturCard
        href="/oppstart"
        pillarLabel="Oppstart"
        headlineValue={m.display}
        headlineCaption="siste 30 dager vs. foregående 30"
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
  let mediaCard;
  if (mediaLatest && media.length >= 5) {
    const sortedIdx = media.map((r) => r.index_value).sort((a, b) => a - b);
    const gauge: GaugeData = {
      value: mediaLatest.index_value,
      min: 0,
      max: 100,
      p10: percentile(sortedIdx, 10),
      p50: percentile(sortedIdx, 50),
      p90: percentile(sortedIdx, 90),
    };
    mediaCard = (
      <TemperaturCard
        href="/media"
        pillarLabel="Mediedekning"
        headlineValue={`${mediaLatest.index_value} / 100`}
        headlineCaption="kibarometer-indeks · siste 30 dager"
        levelLabel={levelDescriptor(mediaLatest.index_value, gauge)}
        levelCaption={`${fmtNumber(mediaLatest.ai_article_count_7d)} ai-artikler siste 7 dager`}
        gauge={gauge}
      />
    );
  } else {
    mediaCard = (
      <TemperaturCardEmpty href="/media" pillarLabel="Mediedekning" />
    );
  }

  const stampMs = [
    jobs?.computed_at,
    brreg?.computed_at,
    mediaLatest?.date ? `${mediaLatest.date}T00:00:00Z` : null,
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
      <section className="text-center">
        <h1 className="mx-auto max-w-3xl text-4xl font-medium leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
          Open source kartlegging av kunstig intelligens i Norge.
        </h1>
        <p className="mx-auto mt-8 max-w-xl text-base text-muted-foreground sm:text-lg">
          Daglig oppdaterte tall fra Norges arbeidsmarked, selskapsstiftelse og
          mediedekning.
        </p>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {jobsCard}
        {oppstartCard}
        {mediaCard}
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
        <span>Versjon 1.0</span>
        {lastUpdated ? <span>Sist oppdatert {lastUpdated}</span> : null}
      </footer>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </main>
  );
}
