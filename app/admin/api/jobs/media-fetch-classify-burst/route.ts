export const runtime = "nodejs";

// Burst variant of media-fetch-classify: K=200, 4-min wall budget.
// Per-source crawl_delay_ms is still respected — bandwidth-bound, not
// LLM-bound, so the backlog drains as fast as politeness allows.

import { runFetchClassify } from "@/lib/admin/legacy/media-fetch-classify.js";
import { sbFetch } from "@/lib/admin/sb";
import { requireBearer } from "@/lib/admin/bearer";

export async function POST(req: Request) {
  const denied = requireBearer(req);
  if (denied) return denied;
  try {
    const result = await runFetchClassify({
      sb: sbFetch,
      trigger: "manual",
      k: 200,
      maxWallMs: 4 * 60_000,
    });
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
