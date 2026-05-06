// POST /admin/api/jobs/brreg-roles-burst — bearer-authed manual-only
// "Catch up backlog" handler. K=500 rows per call, 4-min wall budget.
// Fired from the "Drain role-fetch queue (burst)" button on
// /admin/oppstart (PR 7). Operator can fire repeatedly until the queue
// drains. Same semantics as the cron handler — just larger K + budget.

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
      trigger: "manual",
      k: 500,
      maxWallMs: 4 * 60_000,
    });
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
