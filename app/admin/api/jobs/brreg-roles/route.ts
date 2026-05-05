// POST /admin/api/jobs/brreg-roles — bearer-authed cron entry point.
// Drains up to K=50 pending rows from brreg_url_queue every 30 min,
// fetching /enheter/{orgnr}/roller and persisting natural-person roles
// for the founder-age computation.
//
// Cron tick: 12,42 * * * * (every 30 min).

export const runtime = "nodejs";

import { enrichRolesBrreg } from "@/lib/admin/legacy/brreg.js";
import { sbFetch } from "@/lib/admin/sb";
import { requireBearer } from "@/lib/admin/bearer";

export async function POST(req: Request) {
  const denied = requireBearer(req);
  if (denied) return denied;
  try {
    const result = await enrichRolesBrreg({
      sb: sbFetch,
      trigger: "cron",
      k: 50,
      maxWallMs: 60_000,
    });
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
