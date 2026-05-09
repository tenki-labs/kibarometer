// app/(site)/oppstart/page.tsx — five-segment scroll-snap dashboard for the
// kibarometer brreg/oppstart pipeline.
//
// Server component. Reads from public-RLS brreg_snapshot_* tables via the
// anon key (no service-role calls from the marketing surface). Hands the
// full datasets to <Scroller>, which owns the time-range toggle and the snap
// container.

import type { Metadata } from "next";
import { Suspense } from "react";

import { NORWAY_FYLKE_PATHS, NORWAY_VIEWBOX } from "@/lib/norway-paths";
import {
  sb,
  type BrregSnapshotDaily,
  type BrregSnapshotFounderAgeMonthly,
  type BrregSnapshotGeography,
  type BrregSnapshotHeadline,
  type BrregSnapshotKeyword,
} from "@/lib/supabase";

import { type NaceCategoryLabel, Scroller } from "./_components/scroller";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  title: "Oppstart",
  description:
    "Nye norske foretak fra Brønnøysundregistrene — daglig oppdaterte tall over registrering, AI-andel, vekst og overlevelse.",
  alternates: { canonical: "/oppstart" },
  openGraph: { url: "/oppstart" },
};

export const revalidate = 60;

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  "@id": `${SITE_URL}/oppstart#webpage`,
  url: `${SITE_URL}/oppstart`,
  name: "Oppstart",
  inLanguage: "nb-NO",
};

export default async function OppstartPage() {
  const [headlineRows, daily, founderAgeMonthly, keywords, geography, categories] =
    await Promise.all([
      sb<BrregSnapshotHeadline[]>(
        "/brreg_snapshot_headline?order=computed_for.desc&limit=1",
      ),
      sb<BrregSnapshotDaily[]>(
        "/brreg_snapshot_daily" +
          "?registrert_dato=gte.2018-01-01" +
          "&order=registrert_dato.asc" +
          "&limit=200000",
      ),
      sb<BrregSnapshotFounderAgeMonthly[]>(
        "/brreg_snapshot_founder_age_monthly?order=reg_month.asc",
      ),
      sb<BrregSnapshotKeyword[]>(
        "/brreg_snapshot_keywords?order=rank.asc&limit=20",
      ),
      sb<BrregSnapshotGeography[]>(
        "/brreg_snapshot_geography?order=count_30d.desc",
      ),
      sb<NaceCategoryLabel[]>(
        "/nace_categories?taxonomy_version=eq.sn2025-09&is_active=is.true&select=slug,label_no&order=sort_order.asc",
      ),
    ]);

  const headline = headlineRows[0] ?? null;

  return (
    <>
      <Suspense fallback={null}>
        <Scroller
          headline={headline}
          daily={daily}
          founderAgeMonthly={founderAgeMonthly}
          keywords={keywords}
          geography={geography}
          categories={categories}
          norwayPaths={NORWAY_FYLKE_PATHS}
          norwayViewBox={NORWAY_VIEWBOX}
        />
      </Suspense>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </>
  );
}
