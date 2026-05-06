// POST /admin/api/jobs/brreg-refresh-snapshots — bearer-authed cron entry
// point. Calls public.refresh_all_brreg_snapshots() which truncates and
// rebuilds all five brreg_snapshot_* tables in one transaction.
//
// Cron tick: 45 4 * * * (offset 45 min after NAV's 04:00 snapshot
// refresh and the 03:00 nightly backup).
//
// Manual trigger from /admin/oppstart's "Refresh snapshots" button (PR 7)
// hits the same handler.

export const runtime = "nodejs";

import { refreshBrregSnapshots } from "@/lib/admin/legacy/brreg.js";
import { sbFetch } from "@/lib/admin/sb";
import { requireBearer } from "@/lib/admin/bearer";

export async function POST(req: Request) {
  const denied = requireBearer(req);
  if (denied) return denied;
  try {
    const result = await refreshBrregSnapshots({
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
