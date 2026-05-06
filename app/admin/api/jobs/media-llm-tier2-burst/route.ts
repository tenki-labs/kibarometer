export const runtime = "nodejs";

// Burst variant of media-llm-tier2: K=20, 4-min wall budget.

import { runMediaTier2 } from "@/lib/admin/llm-media-tier2";
import { sbFetch } from "@/lib/admin/sb";
import { requireBearer } from "@/lib/admin/bearer";

export async function POST(req: Request) {
  const denied = requireBearer(req);
  if (denied) return denied;
  try {
    const result = await runMediaTier2({
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
