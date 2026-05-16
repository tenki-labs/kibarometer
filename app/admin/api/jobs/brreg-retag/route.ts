// POST /admin/api/jobs/brreg-retag — bearer-authed cron entry point.
// Calls reprocessBrregCompanies which re-applies the current canonical
// keyword matcher to every brreg_companies row, then chains into
// refreshBrregSnapshots so /oppstart reflects the new tag state.
//
// Cron tick: 15 5 * * 0 (Sundays 05:15 UTC). Mirror of /admin/api/jobs/reprocess
// for NAV at Sundays 03:30 UTC and offentlig-storting-retag at 04:15 UTC.
//
// Manual trigger from /admin/startups/queue's "Keyword-mapping" button
// hits the same orchestrator via after() in reprocessKeywordsAction.

export const runtime = "nodejs";

import { reprocessBrregCompanies } from "@/lib/admin/legacy/brreg-reprocess.js";
import { sbFetch } from "@/lib/admin/sb";
import { requireBearer } from "@/lib/admin/bearer";

export async function POST(req: Request) {
  const denied = requireBearer(req);
  if (denied) return denied;
  try {
    const result = await reprocessBrregCompanies({
      sb: sbFetch,
      trigger: "cron",
    });
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
