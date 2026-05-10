export const runtime = "nodejs";

// Burst variant of llm-classify: K=20, 4-min wall budget. Mirror of
// /admin/api/jobs/{media,brreg}-llm-tier2-burst — used by the
// "Burst Tier 2" button on /admin/job-market and by anyone curl'ing
// from outside the admin UI. Default cron tick remains K=4 for
// kindness to MLX.

import { runClassify } from "@/lib/admin/llm-classify";
import { sbFetch } from "@/lib/admin/sb";
import { requireBearer } from "@/lib/admin/bearer";

export async function POST(req: Request) {
  const denied = requireBearer(req);
  if (denied) return denied;
  try {
    const result = await runClassify({
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
