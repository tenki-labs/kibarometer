// app/(site)/jobbmarked/page.tsx — five-segment scroll-snap dashboard.
//
// Server component. Fetches every snapshot we need in parallel and hands the
// full datasets to <Scroller>, which owns the time-range toggle and the snap
// container. The client slices the per-day snapshots itself so toggling
// max / 1y / 1q / 1m is instant — no extra round trip.
//
// URL: /jobbmarked  (the previous /jobb-barometer redirects here, see
// next.config.ts).

import type { Metadata } from "next";
import { Suspense } from "react";

import { NORWAY_FYLKE_PATHS, NORWAY_VIEWBOX } from "@/lib/norway-paths";
import {
  sb,
  type SnapshotDaily,
  type SnapshotGeography,
  type SnapshotHeadline,
  type SnapshotKeyword,
  type SnapshotSkillCategoryDaily,
  type SnapshotTier2CoverageDaily,
  type TaxonomyCategory,
} from "@/lib/supabase";

import { Scroller } from "./_components/scroller";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  title: "Jobbmarked",
  description:
    "AI-relaterte stillinger i norsk arbeidsmarked — daglig oppdaterte tall fra NAVs stillingsfeed.",
  alternates: { canonical: "/jobbmarked" },
  openGraph: { url: "/jobbmarked" },
};

export const revalidate = 60;

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
      "@type": "WebPage",
      "@id": `${SITE_URL}/jobbmarked#webpage`,
      url: `${SITE_URL}/jobbmarked`,
      name: "Jobbmarked",
      inLanguage: "nb-NO",
      isPartOf: { "@id": `${SITE_URL}/#website` },
      about: { "@id": `${SITE_URL}/#organization` },
    },
  ],
};

export default async function JobbmarkedPage() {
  // PostgREST default cap is 1000 rows (PGRST_DB_MAX_ROWS in
  // docker/supabase/docker-compose.yml). With order=posted_on.asc, hitting that
  // cap silently drops the *most recent* rows. Every snapshot fetch therefore
  // pins an explicit &limit= comfortably above its realistic ceiling.
  const [
    headlineRows,
    snapshotDaily,
    skillCategoryDaily,
    keywords,
    geography,
    taxonomy,
    tier2Coverage,
  ] = await Promise.all([
    sb<SnapshotHeadline[]>(
      "/snapshot_headline?order=computed_for.desc&limit=1",
    ),
    sb<SnapshotDaily[]>(
      "/snapshot_daily?order=posted_on.asc&limit=20000",
    ),
    sb<SnapshotSkillCategoryDaily[]>(
      "/snapshot_skill_category_daily?order=posted_on.asc&limit=200000",
    ),
    sb<SnapshotKeyword[]>("/snapshot_keywords?order=rank.asc&limit=20"),
    sb<SnapshotGeography[]>(
      "/snapshot_geography?order=ai_count_30d.desc&limit=200",
    ),
    sb<TaxonomyCategory[]>(
      "/taxonomy_categories?select=slug,title,definition_md,sort_order&order=sort_order.asc&limit=500",
    ),
    sb<SnapshotTier2CoverageDaily[]>(
      "/snapshot_tier2_coverage_daily?order=date.asc&limit=20000",
    ),
  ]);

  const headline = headlineRows[0] ?? null;

  return (
    <>
      <Suspense fallback={null}>
        <Scroller
          headline={headline}
          snapshotDaily={snapshotDaily}
          skillCategoryDaily={skillCategoryDaily}
          keywords={keywords}
          geography={geography}
          taxonomy={taxonomy}
          tier2Coverage={tier2Coverage}
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
