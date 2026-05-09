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
  type SnapshotCategoryDaily,
  type SnapshotGeography,
  type SnapshotHeadline,
  type SnapshotKeyword,
  type SnapshotSkillCategoryDaily,
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
  const [
    headlineRows,
    categoryDaily,
    skillCategoryDaily,
    keywords,
    geography,
    taxonomy,
  ] = await Promise.all([
    sb<SnapshotHeadline[]>(
      "/snapshot_headline?order=computed_for.desc&limit=1",
    ),
    sb<SnapshotCategoryDaily[]>(
      "/snapshot_category_daily?order=posted_on.asc",
    ),
    sb<SnapshotSkillCategoryDaily[]>(
      "/snapshot_skill_category_daily?order=posted_on.asc",
    ),
    sb<SnapshotKeyword[]>("/snapshot_keywords?order=rank.asc&limit=20"),
    sb<SnapshotGeography[]>("/snapshot_geography?order=ai_count_30d.desc"),
    sb<TaxonomyCategory[]>(
      "/taxonomy_categories?select=slug,title,definition_md,sort_order&order=sort_order.asc",
    ),
  ]);

  const headline = headlineRows[0] ?? null;

  return (
    <>
      <Suspense fallback={null}>
        <Scroller
          headline={headline}
          categoryDaily={categoryDaily}
          skillCategoryDaily={skillCategoryDaily}
          keywords={keywords}
          geography={geography}
          taxonomy={taxonomy}
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
