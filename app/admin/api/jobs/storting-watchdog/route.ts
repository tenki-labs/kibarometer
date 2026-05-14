// POST /admin/api/jobs/storting-watchdog — bearer-authed cron entry.
// Every 5 min tick (offset 1-56/5 to avoid the brreg-roles-watchdog at */5
// and brreg-financials-watchdog at 2-57/5). Calls the shared
// sweepStaleRunningJobs which marks any storting job stuck in status=running
// past STALE_RUNNING_MS (30 min) or HEARTBEAT_STALE_MS (5 min since last
// heartbeat) as failed. Storting orchestrators already call this sweep
// opportunistically at startup; the cron is the standalone safety net.

export const runtime = "nodejs";

import { sweepStaleRunningJobs } from "@/lib/admin/legacy/jobs.js";
import { sbFetch } from "@/lib/admin/sb";
import { requireBearer } from "@/lib/admin/bearer";

export async function POST(req: Request) {
  const denied = requireBearer(req);
  if (denied) return denied;
  try {
    await sweepStaleRunningJobs(sbFetch);
    return Response.json({ swept_at: new Date().toISOString() });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
