// POST /admin/api/jobs/brreg-backfill — bearer-authed manual-only entry
// point for the brreg bulk-dump backfill. NOT on the cron schedule:
// this is a long-running (~10–30 min) one-shot operator trigger fired
// from the "Backfill" button in /admin/startups.
//
// Renamed from brreg-bootstrap in PR 7 of the admin restructure to
// align with the standard "Backfill" framing across all domains
// (NAV's full drain, brreg's full registry load — both now called
// Backfill rather than mixing Bootstrap and Backfill).
//
// Streams brreg's daily JSON dump (~200 MB compressed). The legacy
// floor-date filter (app_settings.brreg_bootstrap_floor_date) was
// deprecated in migration 0033 — backfill now loads the full registry
// by default. The ?floor=YYYY-MM-DD query param still works for
// callers who want a one-off filter (e.g. CI testing), but no UI
// surfaces it anymore.
// Idempotent on orgnr; safe to re-run.

export const runtime = "nodejs";

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
