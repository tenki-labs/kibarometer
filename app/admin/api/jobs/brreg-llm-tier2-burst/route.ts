export const runtime = "nodejs";

// Burst variant of brreg-llm-tier2: K=20, 4-min wall budget. Mirror of
// /admin/api/jobs/media-llm-tier2-burst — used by the "Burst Tier 2"
// button on /admin/startups/queue and by anyone curl'ing from outside
// the admin UI. Default cron tick remains K=4 for kindness to MLX.

import { runBrregTier2 } from "@/lib/admin/llm-brreg-tier2";
import { sbFetch } from "@/lib/admin/sb";
import { requireBearer } from "@/lib/admin/bearer";

export async function POST(req: Request) {
  const denied = requireBearer(req);
  if (denied) return denied;
  try {
    const result = await runBrregTier2({
      sb: sbFetch,
      trigger: "manual",
      k: 20,
      wallTimeMs: 4 * 60_000,
    });
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
