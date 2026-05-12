// POST /admin/api/jobs/offentlig-storting-fetch — bearer-authed cron entry.
// Daily 07:00 UTC tick (30 min after BRREG ingest at 06:30, 60 min after NAV
// at 06:00). Calls fetchStorting() against the active parliamentary session.
//
// Manual override: pass ?sessionId=YYYY-YYYY to re-ingest a specific session
// (e.g. recovering from a missed cron, or ad-hoc re-pull after a keyword
// catalog change).

export const runtime = "nodejs";

import { fetchStorting } from "@/lib/admin/legacy/storting.js";
import { sbFetch } from "@/lib/admin/sb";
import { requireBearer } from "@/lib/admin/bearer";

export async function POST(req: Request) {
  const denied = requireBearer(req);
  if (denied) return denied;
  try {
    const url = new URL(req.url);
    const sessionId = url.searchParams.get("sessionId") || null;
    const result = await fetchStorting({
      sb: sbFetch,
      trigger: "cron",
      sessionId,
    });
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
