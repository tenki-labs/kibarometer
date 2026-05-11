// app/(site)/arbeidsmarked/page.tsx — five-segment scroll-snap dashboard.
//
// Server component. Fetches every snapshot we need in parallel and hands the
// full datasets to <Scroller>, which owns the time-range toggle and the snap
// container. The client slices the per-day snapshots itself so toggling
// max / 1y / 1q / 1m is instant — no extra round trip.
//
// URL: /arbeidsmarked  (the previous /jobb-barometer redirects here, see
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

import {
  JOBBMARKED_DATA_CUTOFF,
  JOBBMARKED_THIRTY_DAY_VALID_FROM,
} from "@/app/(site)/_lib/data-cutoff";

import { Scroller, type HeroMomentum } from "./_components/scroller";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  title: "Arbeidsmarked",
  description:
    "AI-relaterte stillinger i norsk arbeidsmarked — daglig oppdaterte tall fra NAVs stillingsfeed.",
  alternates: { canonical: "/arbeidsmarked" },
  openGraph: { url: "/arbeidsmarked" },
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
      "@id": `${SITE_URL}/arbeidsmarked#webpage`,
      url: `${SITE_URL}/arbeidsmarked`,
      name: "Arbeidsmarked",
      inLanguage: "nb-NO",
      isPartOf: { "@id": `${SITE_URL}/#website` },
      about: { "@id": `${SITE_URL}/#organization` },
    },
  ],
};

export default async function ArbeidsmarkedPage() {
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
    // Daily snapshots filter to JOBBMARKED_DATA_CUTOFF — pre-cutoff rows
    // were ingested via backfill from NAV's archive feed and never had
    // their description fetched (INACTIVE-at-ingest), so the classifier
    // saw title-only text and undercounts AI by ~10x. See
    // app/(site)/_lib/data-cutoff.ts for the methodology.
    sb<SnapshotDaily[]>(
      `/snapshot_daily?order=posted_on.asc&posted_on=gte.${JOBBMARKED_DATA_CUTOFF}&limit=20000`,
    ),
    sb<SnapshotSkillCategoryDaily[]>(
      `/snapshot_skill_category_daily?order=posted_on.asc&posted_on=gte.${JOBBMARKED_DATA_CUTOFF}&limit=200000`,
    ),
    sb<SnapshotKeyword[]>("/snapshot_keywords?order=rank.asc&limit=20"),
    sb<SnapshotGeography[]>(
      "/snapshot_geography?order=ai_count_30d.desc&limit=200",
    ),
    sb<TaxonomyCategory[]>(
      "/taxonomy_categories?select=slug,title,definition_md,sort_order&order=sort_order.asc&limit=500",
    ),
    sb<SnapshotTier2CoverageDaily[]>(
      `/snapshot_tier2_coverage_daily?order=date.asc&date=gte.${JOBBMARKED_DATA_CUTOFF}&limit=20000`,
    ),
  ]);

  const headline = headlineRows[0] ?? null;
  const momentum = buildMomentum(headline, snapshotDaily);

  return (
    <>
      <Suspense fallback={null}>
        <Scroller
          headline={headline}
          momentum={momentum}
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

// Derive the hero's pct-change number from honest data. Until
// JOBBMARKED_THIRTY_DAY_VALID_FROM (2026-06-12), snapshot_headline's
// prior_30d window dips into pre-cutoff title-only-classified rows and
// produces inflated ratios (e.g. +791% on 2026-05-11 when the real
// AI-percent has been roughly stable). Auto-flip on/after that date.
function buildMomentum(
  headline: SnapshotHeadline | null,
  snapshotDaily: SnapshotDaily[],
): HeroMomentum {
  const today = new Date().toISOString().slice(0, 10);
  if (today >= JOBBMARKED_THIRTY_DAY_VALID_FROM && headline) {
    const pct =
      headline.ai_count_prev_30d > 0
        ? ((headline.ai_count_30d - headline.ai_count_prev_30d) /
            headline.ai_count_prev_30d) *
          100
        : null;
    return { pct, caption: "siste 30 dager vs. foregående 30" };
  }
  // Week-over-week from cutoff-truncated snapshot_daily. Anchor "now" to the
  // latest posted_on in the snapshot rather than wall clock — keeps the
  // window stable across 04:00 UTC snapshot rebuilds.
  let latest = 0;
  for (const row of snapshotDaily) {
    const t = new Date(row.posted_on + "T00:00:00Z").getTime();
    if (t > latest) latest = t;
  }
  if (latest === 0) return { pct: null, caption: "siste 7 dager vs. foregående 7" };
  const dayMs = 86_400_000;
  const sevenAgo = latest - 7 * dayMs;
  const fourteenAgo = latest - 14 * dayMs;
  let ai7 = 0;
  let aiPrev7 = 0;
  for (const row of snapshotDaily) {
    const t = new Date(row.posted_on + "T00:00:00Z").getTime();
    if (t > sevenAgo && t <= latest) ai7 += row.ai_count;
    else if (t > fourteenAgo && t <= sevenAgo) aiPrev7 += row.ai_count;
  }
  const pct = aiPrev7 > 0 ? ((ai7 - aiPrev7) / aiPrev7) * 100 : null;
  return { pct, caption: "siste 7 dager vs. foregående 7" };
}
