// lib/supabase.ts — server-side PostgREST helper for the marketing app.
//
// Uses SUPABASE_INTERNAL_URL (Kong inside the Docker network) rather than the
// public host so reads stay on the kiba network and don't hairpin through the
// edge. The anon key is fine: every snapshot_* table has a public-read RLS
// policy from 0008_nav_snapshots.sql.
//
// All callers are server components / route handlers — never import this from
// a client component (no "use client" file should reach for it).

import { env } from "./env";

type Init = Omit<RequestInit, "body"> & {
  body?: unknown;
  // Override Next's revalidate per call. Default is 60s — snapshots refresh
  // once per day, so this is comfortably stale-tolerant; the dashboard's
  // visible "Sist oppdatert" stamp tells users when the snapshot was computed.
  revalidate?: number;
};

export async function sb<T = unknown>(path: string, init: Init = {}): Promise<T> {
  // CI/build-time short-circuit: `next build` prerenders every route, which
  // would call this fn with placeholder env where SUPABASE_INTERNAL_URL is
  // unreachable (ECONNREFUSED). Return empty so prerender succeeds; the
  // first real request after deploy hits the real Kong and ISR fills the
  // cache. Every consumer in this app expects an array shape, so [] is
  // type-compatible across the board.
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return [] as unknown as T;
  }
  const { revalidate = 60, body, headers, ...rest } = init;
  const res = await fetch(`${env.SUPABASE_INTERNAL_URL}/rest/v1${path}`, {
    ...rest,
    headers: {
      apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    next: { revalidate },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PostgREST ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

// ---- Row types mirroring the snapshot_* schema ------------------------

export type SnapshotHeadline = {
  computed_for: string;     // YYYY-MM-DD
  computed_at: string;      // ISO timestamp
  ai_count_7d: number;
  ai_count_30d: number;
  ai_count_prev_30d: number;
  ai_share_30d: number;     // 0..1
};

export type SnapshotDaily = {
  posted_on: string;        // YYYY-MM-DD
  ai_count: number;
  total_count: number;
};

export type SnapshotMonthly = {
  posted_month: string;     // YYYY-MM-01
  ai_count: number;
  total_count: number;
};

export type SnapshotKeyword = {
  keyword: string;
  category: string | null;  // tool / role / concept
  ai_count_30d: number;
  ai_count_30d_yoy: number;
  yoy_growth_pct: number | null;
  rank: number;
};

export type SnapshotGeography = {
  county: string;
  ai_count_30d: number;
  total_count_30d: number;
};

export type SnapshotCategory = {
  category: string;
  ai_count_30d: number;
  total_count_30d: number;
};

export type SnapshotCategoryDaily = {
  posted_on: string;        // YYYY-MM-DD
  category: string;
  ai_count: number;
  total_count: number;
};

export type SnapshotSkillCategoryDaily = {
  posted_on: string;        // YYYY-MM-DD
  slug: string;
  ai_count: number;
};

// Per-day Tier 2 backfill coverage. Drives the public "LLM-validert: X%
// av AI-treff i valgt periode" banner. coverage_pct is a stored generated
// column (clipped to 100 when ai_total = 0). One row per pillar:
// public.snapshot_tier2_coverage_daily / media_…/brreg_… have identical
// schema (see 0056_tier2_coverage_daily.sql).
export type SnapshotTier2CoverageDaily = {
  date: string;             // YYYY-MM-DD
  ai_total: number;
  tier2_done: number;
  coverage_pct: number;     // 0-100
};

// AI-skill category snapshot (LLM Tier 2 classification rolled up per slug).
// See 0021_skill_snapshot.sql. The home page reads the rows for the latest
// `computed_for` and joins with taxonomy_categories on slug to pick up the
// human-readable title.
export type SnapshotSkillCategory = {
  computed_for: string;     // YYYY-MM-DD
  slug: string;
  ai_count_30d: number;
  ai_count_7d: number;
  share_pct: number | null;
};

// Public taxonomy row used by /metode and the home-page skill chart.
export type TaxonomyCategory = {
  slug: string;
  title: string;
  definition_md: string;
  sort_order: number;
};

// Public keyword (used by /metode methodology page).
export type Keyword = {
  id: string;
  term: string;
  language: "no" | "en" | "any";
  category: "tool" | "role" | "concept";
  match_type: "word" | "substring";
  notes: string | null;
};

// ---- Media snapshot types (0029_media.sql, public-read) -----------------

export type MediaSnapshotIndex = {
  date: string;                    // YYYY-MM-DD
  index_value: number;             // 0..100
  article_count_7d: number;
  ai_article_count_7d: number;
  categories_above_water: number;
  categories_below_water: number;
};

export type MediaSnapshotCategoryDaily = {
  published_on: string;            // YYYY-MM-DD
  category_slug: string;
  ai_count: number;
  distinct_story_count: number;
  temperature: number | null;
};

export type MediaAnomalyDaily = {
  date: string;                    // YYYY-MM-DD
  category_slug: string;
  count: number;
  baseline_mean: number;
  baseline_stddev: number;
  z_score: number;
  is_spike: boolean;
};

export type MediaCategory = {
  slug: string;
  label_no: string;
  label_en: string | null;
  description: string | null;
};

// ---- Brreg snapshot types (0030_brreg.sql, public-read) -----------------

export type BrregSnapshotHeadline = {
  computed_for: string;
  computed_at: string;
  total_7d: number;
  total_30d: number;
  total_30d_yoy: number;
  ai_relevant_count_30d: number;
  ai_relevant_share_30d: number;          // 0..1
  it_share_30d: number;
  kreativ_media_share_30d: number;
  tjenester_share_30d: number;
  enriched_combined_share_30d: number;
  as_share_of_ai_relevant_30d: number;
  enk_share_of_ai_relevant_30d: number;
  aksjekapital_median_ai_relevant_as_30d: number | null;
  aksjekapital_median_non_ai_as_30d: number | null;
  ai_relevant_mom_growth: number | null;
  ai_relevant_qoq_growth: number | null;
};

export type BrregSnapshotDaily = {
  registrert_dato: string;         // YYYY-MM-DD
  nace_category_slug: string;
  count: number;
  ai_relevant_count: number;
  young_founder_count: number;
};

export type BrregSnapshotGeography = {
  fylke: string;
  count_30d: number;
  ai_relevant_count_30d: number;
  count_per_100k_30d: number | null;
};

export type BrregSnapshotCohort = {
  cohort_quarter: string;
  is_ai_relevant: boolean;
  total_at_registration: number;
  still_active_count: number;
  slettet_count: number;
  konkurs_count: number;
  survival_rate_pct: number;
};

export type BrregSnapshotFounderAgeYearly = {
  reg_year: number;
  is_ai_relevant: boolean;
  median_youngest_age: number | null;
  p25_youngest_age: number | null;
  p75_youngest_age: number | null;
  sample_size: number;
};

export type BrregSnapshotFounderAgeMonthly = {
  reg_month: string;               // YYYY-MM-01
  is_ai_relevant: boolean;
  mean_youngest_age: number | null;
  stddev_youngest_age: number | null;
  sample_size: number;
};

export type BrregSnapshotKeyword = {
  keyword: string;
  category: string | null;         // tool / role / concept
  ai_count_30d: number;
  ai_count_30d_yoy: number;
  yoy_growth_pct: number | null;
  rank: number;
};

// Quarterly YoY growth of AI-relevant BRREG registrations
// (0065_brreg_snapshot_quarterly_ai_growth.sql). One row per completed
// quarter since 2018-01-01; powers the /oppstart PillarHero KPI, the
// landing page's BRREG hero stat, and the new quarterly-yoy bar chart.
export type BrregSnapshotQuarterlyAiGrowth = {
  reg_quarter: string;             // YYYY-MM-DD, first day of quarter
  ai_count: number;
  ai_count_yoy_prior: number | null;
  yoy_growth_pct: number | null;
};

// Regnskapsregisteret-derived yearly aggregates (0064_brreg_financials.sql).
// One row per (fiscal_year × is_ai_relevant); powers Segments 1 + 2 on
// /oppstart (Pareto variance + revenue growth).
export type BrregSnapshotFinancialsYearly = {
  fiscal_year: number;
  is_ai_relevant: boolean;
  company_count: number;
  sum_omsetning: number;
  p25_omsetning: number | null;
  median_omsetning: number | null;
  p75_omsetning: number | null;
  p90_omsetning: number | null;
  p99_omsetning: number | null;
  mean_omsetning: number | null;
  gini_omsetning: number | null;       // 0..1
  top10_share: number | null;          // 0..1
  top1pct_share: number | null;        // 0..1
  mean_revenue_per_employee: number | null;
  // Array of [x, y] pairs in [0..1]² for the Lorenz curve.
  // x = cumulative share of companies, y = cumulative share of revenue,
  // sorted ascending. ~21 points including the [0, 0] origin.
  lorenz_points: [number, number][] | null;
};

// Cohort-card snapshot (0064_brreg_financials.sql). One row per
// (cohort_year × is_ai_relevant) carrying the latest observation year's
// numbers. Powers Segment 3 on /oppstart.
export type BrregSnapshotFinancialsCohort = {
  cohort_year: number;
  is_ai_relevant: boolean;
  observation_year: number;
  cohort_size: number;
  alive_count: number;
  filing_positive_count: number;
  median_revenue_filing: number | null;
  mean_revenue_per_employee_filing: number | null;
  top_performer_orgnr: string | null;
  top_performer_name: string | null;
  top_performer_revenue: number | null;
};
