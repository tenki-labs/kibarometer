// app/(site)/media/page.tsx — five-segment scroll-snap dashboard for the
// kibarometer media-temperature index.
//
// Server component. Fetches every snapshot we need in parallel and hands the
// full datasets to <Scroller>, which owns the time-range toggle and the snap
// container. The client slices the per-day rows itself so toggling
// max / 1y / 1q / 1m is instant — no extra round trip.

import type { Metadata } from "next";
import { Suspense } from "react";

import {
  sb,
  type MediaAnomalyDaily,
  type MediaCategory,
  type MediaSnapshotCategoryDaily,
  type MediaSnapshotIndex,
  type SnapshotTier2CoverageDaily,
} from "@/lib/supabase";

import { MEDIA_DATA_CUTOFF } from "@/app/(site)/_lib/media-cutoff";

import { Scroller } from "./_components/scroller";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  title: "Media",
  description:
    "Norsk medieklima for kunstig intelligens — daglig oppdatert kibarometer-indeks fra norske mediers AI-dekning.",
  alternates: { canonical: "/media" },
  openGraph: { url: "/media" },
};

export const revalidate = 60;

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  "@id": `${SITE_URL}/media#webpage`,
  url: `${SITE_URL}/media`,
  name: "Media",
  inLanguage: "nb-NO",
};

export default async function MediaPage() {
  // Snapshot queries filter to MEDIA_DATA_CUTOFF — pre-2024 rows exist
  // in the snapshot tables (old RSS/sitemap ingest, some outlets back
  // to 2015) but are hidden on the public page: pre-ChatGPT coverage
  // is sparse and the keyword catalog used at the time was narrower
  // than today's. See app/(site)/_lib/media-cutoff.ts for the
  // methodology.
  const [
    latestRows,
    priorRows,
    indexHistory,
    categoryDaily,
    categories,
    anomalies,
    tier2Coverage,
  ] = await Promise.all([
    sb<MediaSnapshotIndex[]>(
      `/media_snapshot_index?order=date.desc&date=gte.${MEDIA_DATA_CUTOFF}&limit=1`,
    ),
    sb<MediaSnapshotIndex[]>(
      `/media_snapshot_index?order=date.desc&date=gte.${MEDIA_DATA_CUTOFF}&offset=7&limit=1`,
    ),
    sb<MediaSnapshotIndex[]>(
      `/media_snapshot_index?order=date.asc&date=gte.${MEDIA_DATA_CUTOFF}`,
    ),
    sb<MediaSnapshotCategoryDaily[]>(
      `/media_snapshot_category_daily?order=published_on.asc&published_on=gte.${MEDIA_DATA_CUTOFF}`,
    ),
    sb<MediaCategory[]>(
      "/media_categories?is_active=is.true&select=slug,label_no,label_en,description&order=slug.asc",
    ),
    sb<MediaAnomalyDaily[]>(
      `/media_anomaly_daily?is_spike=is.true&date=gte.${MEDIA_DATA_CUTOFF}&order=date.desc,z_score.desc&limit=500`,
    ),
    sb<SnapshotTier2CoverageDaily[]>(
      `/media_snapshot_tier2_coverage_daily?order=date.asc&date=gte.${MEDIA_DATA_CUTOFF}&limit=20000`,
    ),
  ]);

  const latest = latestRows[0] ?? null;
  const prior = priorRows[0] ?? null;

  return (
    <>
      <Suspense fallback={null}>
        <Scroller
          latest={latest}
          prior={prior}
          indexHistory={indexHistory}
          categoryDaily={categoryDaily}
          categories={categories}
          anomalies={anomalies}
          tier2Coverage={tier2Coverage}
        />
      </Suspense>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </>
  );
}
