// app/(site)/offentlig/page.tsx — public /offentlig dashboard. Storting-only
// for now (Doffin half ships in a separate PR once DFØ API access lands).
//
// Server component. Fetches every snapshot the page needs in parallel and
// hands the full datasets to <Scroller>, which owns the time-range toggle
// and the snap container. The client slices the rows itself so toggling
// max / 1y / 6m / 1m is instant — no extra round trip.

import type { Metadata } from "next";
import { Suspense } from "react";

import { sb } from "@/lib/supabase";
import { OFFENTLIG_DATA_CUTOFF } from "@/app/(site)/_lib/offentlig-cutoff";

import { Scroller } from "./_components/scroller";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  title: "Offentlig sektor",
  description:
    "Hvordan norsk offentlig sektor bruker og debatterer kunstig intelligens — kunngjøringer fra Stortinget koblet med kommende AI-anskaffelser fra Doffin.",
  alternates: { canonical: "/offentlig" },
  openGraph: { url: "/offentlig" },
};

export const revalidate = 60;

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  "@id": `${SITE_URL}/offentlig#webpage`,
  url: `${SITE_URL}/offentlig`,
  name: "Offentlig sektor",
  inLanguage: "nb-NO",
};

// Snapshot row types. Doffin-related columns on the headline are nullable
// today and will populate once B2-doffin ships; we still pull them so the
// page renders the same shape end-to-end.
export type OffentligHeadline = {
  computed_for: string;
  computed_at: string;
  total_saker_ai: number | null;
  total_saker_ai_12m: number | null;
  total_saker_ai_prior_12m: number | null;
  debate_yoy_pct: number | null;
  top_komite_navn: string | null;
  top_komite_count: number | null;
  // Doffin side — nullable until that half is online
  total_notices_ai: number | null;
  total_nok_ai: number | null;
  spend_yoy_pct: number | null;
  kommune_share_pct: number | null;
  top_buyer_agency: string | null;
  top_vendor_navn: string | null;
};

export type StortingMonthly = {
  computed_for: string; // first-of-month date
  category_slug: string; // includes synthetic '__uncategorized'
  ai_count: number;
};

export type StortingCategory = {
  slug: string;
  label_no: string;
  label_en: string | null;
  sort_order: number;
};

export default async function OffentligPage() {
  const [headlineRows, monthly, categories] = await Promise.all([
    sb<OffentligHeadline[]>(
      `/offentlig_snapshot_headline?order=computed_for.desc&limit=1`,
    ).catch(() => [] as OffentligHeadline[]),
    sb<StortingMonthly[]>(
      `/offentlig_snapshot_storting_monthly?order=computed_for.asc&computed_for=gte.${OFFENTLIG_DATA_CUTOFF}`,
    ).catch(() => [] as StortingMonthly[]),
    sb<StortingCategory[]>(
      "/storting_categories?is_active=is.true&select=slug,label_no,label_en,sort_order&order=sort_order.asc,slug.asc",
    ).catch(() => [] as StortingCategory[]),
  ]);

  const headline = headlineRows[0] ?? null;

  return (
    <>
      <Suspense fallback={null}>
        <Scroller
          headline={headline}
          monthly={monthly}
          categories={categories}
        />
      </Suspense>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </>
  );
}
