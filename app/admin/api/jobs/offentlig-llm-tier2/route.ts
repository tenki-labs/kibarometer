// POST /admin/api/jobs/offentlig-llm-tier2 — bearer-authed cron entry.
// Tier 2 (taxonomy slug assignment) for the /offentlig pillar.
//
// Currently calls only the Stortinget half. Doffin tier2 will be added
// in a later PR once lib/admin/llm-doffin-tier2.ts ships.
//
// Tier 2 gates on is_ai_relevant directly (NOT on tier1_completed_at) so
// backfilled rows get categorized too — Tier 1 is forward-only on live
// ingest but Tier 2 needs to drain history.

export const runtime = "nodejs";

import { runStortingTier2 } from "@/lib/admin/llm-storting-tier2";
import { sbFetch } from "@/lib/admin/sb";
import { requireBearer } from "@/lib/admin/bearer";

export async function POST(req: Request) {
  const denied = requireBearer(req);
  if (denied) return denied;
  try {
    const storting = await runStortingTier2({ sb: sbFetch, trigger: "cron" });
    return Response.json({ storting });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
