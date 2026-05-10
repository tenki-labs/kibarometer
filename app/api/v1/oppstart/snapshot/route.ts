// GET /api/v1/oppstart/snapshot — public, cite-able JSON snapshot of the
// /oppstart dashboard. No auth. NLOD 2.0 attribution rendered in the
// `_attribution` field of the response.
//
// Response shape is versioned via `_schema_version` so we can evolve
// without breaking embeds.

import { sb } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BrregHeadline = {
  computed_for: string;
  computed_at: string;
  total_7d: number;
  total_30d: number;
  total_30d_yoy: number;
  ai_relevant_count_30d: number;
  ai_relevant_share_30d: number;
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

type BrregGeography = {
  fylke: string;
  count_30d: number;
  ai_relevant_count_30d: number;
};

type BrregCohort = {
  cohort_quarter: string;
  is_ai_relevant: boolean;
  total_at_registration: number;
  still_active_count: number;
  survival_rate_pct: number;
};

export async function GET() {
  try {
    const [headlineRows, geography, cohort] = await Promise.all([
      sb<BrregHeadline[]>(
        "/brreg_snapshot_headline?order=computed_for.desc&limit=1",
      ),
      sb<BrregGeography[]>(
        "/brreg_snapshot_geography?select=fylke,count_30d,ai_relevant_count_30d&order=count_30d.desc",
      ),
      sb<BrregCohort[]>(
        "/brreg_snapshot_cohort?select=cohort_quarter,is_ai_relevant,total_at_registration,still_active_count,survival_rate_pct&order=cohort_quarter.asc",
      ),
    ]);

    const headline = headlineRows[0] ?? null;

    const body = {
      _schema_version: "1",
      _attribution:
        "Inneholder data under NLOD 2.0 tilgjengeliggjort av Brønnøysundregistrene",
      computed_for: headline?.computed_for ?? null,
      computed_at: headline?.computed_at ?? null,
      headline,
      geography,
      cohort,
    };

    return Response.json(body, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
