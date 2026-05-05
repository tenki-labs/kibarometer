// POST /admin/api/jobs/brreg-bootstrap — bearer-authed manual-only entry
// point for the bulk-dump bootstrap. NOT on the cron schedule: this is a
// long-running (~10–30 min depending on floor date) one-shot operator
// trigger fired from the "Run bootstrap" button in /admin/oppstart (PR 7).
//
// Streams brreg's daily JSON dump (~200 MB compressed), filters by
// app_settings.brreg_bootstrap_floor_date (default 2018-01-01) or an
// optional ?floor=YYYY-MM-DD override, and batch-upserts into
// brreg_companies. Idempotent on orgnr; safe to re-run.

export const runtime = "nodejs";
// Bootstrap can run for many minutes; opt out of any default route timeout.
export const maxDuration = 60 * 60; // 60 min

import { bootstrapBrreg } from "@/lib/admin/legacy/brreg.js";
import { sbFetch } from "@/lib/admin/sb";
import { requireBearer } from "@/lib/admin/bearer";

export async function POST(req: Request) {
  const denied = requireBearer(req);
  if (denied) return denied;
  try {
    const url = new URL(req.url);
    const floorDate = url.searchParams.get("floor") || null;
    const result = await bootstrapBrreg({
      sb: sbFetch,
      trigger: "manual",
      floorDate,
    });
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
