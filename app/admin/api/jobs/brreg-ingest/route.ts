// POST /admin/api/jobs/brreg-ingest — bearer-authed cron entry point.
// Daily 06:30 UTC tick (offset 30 min after NAV's 06:00 daily fetch).
// Runs fetchBrreg() with default date window (yesterday-only).
//
// Manual trigger from /admin/startups (PR 7) will hit this same handler
// with optional `?from=YYYY-MM-DD&to=YYYY-MM-DD` query params for ad-hoc
// re-ingestion of a custom window (e.g. recovering from a missed cron).

export const runtime = "nodejs";

import { fetchBrreg } from "@/lib/admin/legacy/brreg.js";
import { sbFetch } from "@/lib/admin/sb";
import { requireBearer } from "@/lib/admin/bearer";

export async function POST(req: Request) {
  const denied = requireBearer(req);
  if (denied) return denied;
  try {
    const url = new URL(req.url);
    const fromDate = url.searchParams.get("from") || null;
    const toDate = url.searchParams.get("to") || null;
    const result = await fetchBrreg({
      sb: sbFetch,
      trigger: "cron",
      fromDate,
      toDate,
    });
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
