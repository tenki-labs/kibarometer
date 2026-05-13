// POST /admin/api/jobs/brreg-financials-watchdog — fired every 5 min by
// kiba-fetcher. Detects dead manual financials-burst drains (kiba-web
// restart killed the JS process; last_heartbeat went stale) and auto-
// resumes them.
//
// On each tick:
//   1. Reap drains where status=running and last_heartbeat < 3 min ago.
//   2. If reaped ≥ 1 AND candidate pool still has rows AND no live drain →
//      spawn a fresh burst via after().
//
// Auto-resume is gated on "reaped ≥ 1" so the watchdog does NOT start a
// drain from scratch — the :18 hourly cron at K=50 handles steady-state
// ingest, and the manual "Backfill alle" button is the only entry point
// for a cold start.

export const runtime = "nodejs";

import { after } from "next/server";

import { sbFetch } from "@/lib/admin/sb";
import { requireBearer } from "@/lib/admin/bearer";
import {
  countBrregFinancialsBacklog,
  findLiveBrregFinancialsDrainJob,
  insertBrregFinancialsDrainJob,
  reapStaleBrregFinancialsDrains,
  runBrregFinancialsFullDrain,
} from "@/lib/admin/brreg-financials-drain";

export async function POST(req: Request) {
  const denied = requireBearer(req);
  if (denied) return denied;
  try {
    const reaped = await reapStaleBrregFinancialsDrains(sbFetch);
    let resumed: { job_id: string; backlog: number } | null = null;
    let backlog = 0;

    if (reaped > 0) {
      backlog = await countBrregFinancialsBacklog(sbFetch);
      const live = await findLiveBrregFinancialsDrainJob(sbFetch);
      if (backlog > 0 && !live) {
        const job = await insertBrregFinancialsDrainJob(
          sbFetch,
          backlog,
          "watchdog",
        );
        after(async () => {
          try {
            await runBrregFinancialsFullDrain({
              sb: sbFetch,
              jobId: job.id,
              initialBacklog: backlog,
            });
          } catch {
            // Orchestrator finalizes its own jobs row on error.
          }
        });
        resumed = { job_id: job.id, backlog };
      }
    }

    return Response.json({ reaped, resumed, backlog });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
