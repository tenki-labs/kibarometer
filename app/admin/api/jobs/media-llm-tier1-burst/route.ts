export const runtime = "nodejs";

// Burst variant of media-llm-tier1: K=100, 4-min wall budget. Operator
// presses "Catch up backlog" after a backfill burst to drain the
// is_ai_related queue faster than the K=15 cron can. Bearer-authed; same
// orchestrator, different knobs.

import { runMediaTier1 } from "@/lib/admin/llm-media-tier1";
import { sbFetch } from "@/lib/admin/sb";
import { requireBearer } from "@/lib/admin/bearer";

export async function POST(req: Request) {
  const denied = requireBearer(req);
  if (denied) return denied;
  try {
    const result = await runMediaTier1({
      sb: sbFetch,
      trigger: "manual",
      k: 100,
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
