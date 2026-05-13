// POST /admin/api/jobs/brreg-financials — bearer-authed cron entry point.
// Once-hourly tick (:18 *) drains up to K=20 AI-flagged orgnrs without
// recent Regnskapsregisteret data. Each fetch is a single HTTP call to
// data.brreg.no/regnskapsregisteret/regnskap/{orgnr} — no LLM, no
// per-row inference.
//
// Annual data only — the retry cadence is 180 days per orgnr, so once a
// company has either filed (OK) or returned NO_FILINGS, we won't re-hit
// the API for half a year. Manual override from /admin/startups/financials
// can force an immediate drain via a custom ?k=… query param.

export const runtime = "nodejs";

import { drainFinancials } from "@/lib/admin/legacy/brreg-financials.js";
import { sbFetch } from "@/lib/admin/sb";
import { requireBearer } from "@/lib/admin/bearer";

export async function POST(req: Request) {
  const denied = requireBearer(req);
  if (denied) return denied;
  try {
    const url = new URL(req.url);
    const kParam = url.searchParams.get("k");
    const k = kParam ? Math.max(1, Math.min(200, Number(kParam) || 20)) : 20;
    const result = await drainFinancials({
      sb: sbFetch,
      trigger: "cron",
      k,
    });
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
