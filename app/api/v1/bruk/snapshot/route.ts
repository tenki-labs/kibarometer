// GET /api/v1/bruk/snapshot — public, cite-able JSON of the /bruk dashboard.
// No auth. CC-BY 4.0 attribution. Mirrors /api/v1/oppstart/snapshot shape:
// _schema_version + _attribution + computed_for + the precomputed aggregate
// cuts.

import { sb } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AggregateRow = {
  cut: string;
  bucket: string;
  confirmed_count: number;
  share_pct: number | null;
  computed_at: string;
};

export async function GET() {
  try {
    const rows = await sb<AggregateRow[]>(
      "/bruk_aggregate_snapshot?select=cut,bucket,confirmed_count,share_pct,computed_at&order=cut.asc,confirmed_count.desc",
    );

    // Bucket by cut so consumers can pluck what they need without filtering.
    const byCut: Record<string, Array<Omit<AggregateRow, "computed_at" | "cut">>> = {};
    for (const r of rows) {
      const list = byCut[r.cut] ?? (byCut[r.cut] = []);
      list.push({
        bucket: r.bucket,
        confirmed_count: r.confirmed_count,
        share_pct: r.share_pct,
      });
    }

    // computed_for derives from the snapshot's own computed_at — they all
    // share the same value because the cron rebuilds in one transaction.
    const computedFor = rows[0]?.computed_at ?? null;
    const totalConfirmed = byCut.overall?.[0]?.confirmed_count ?? 0;

    const body = {
      _schema_version: "1",
      _attribution:
        "Selvrapporterte data fra respondenter på kibarometer.no/bruk. " +
        "Aggregerte, anonymiserte tall. Lisens: CC-BY 4.0.",
      _disclaimer:
        "Ikke-representativt utvalg. Skal siteres som kohortstudie, " +
        "ikke populasjonsstudie. Se /docs/bruk for metode.",
      computed_for: computedFor,
      total_confirmed: totalConfirmed,
      cuts: {
        overall: byCut.overall ?? [],
        by_q1_bransje: byCut.by_q1_bransje ?? [],
        by_q2_frequency: byCut.by_q2_frequency ?? [],
        by_q3_tool: byCut.by_q3_tool ?? [],
        by_q4_use_case: byCut.by_q4_use_case ?? [],
        by_q5_policy: byCut.by_q5_policy ?? [],
        by_q1_q2_heatmap: byCut.by_q1_q2_heatmap ?? [],
      },
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
