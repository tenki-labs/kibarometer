export const runtime = "nodejs";

import { runMediaTier1 } from "@/lib/admin/llm-media-tier1";
import { sbFetch } from "@/lib/admin/sb";
import { requireBearer } from "@/lib/admin/bearer";

export async function POST(req: Request) {
  const denied = requireBearer(req);
  if (denied) return denied;
  try {
    const result = await runMediaTier1({ sb: sbFetch, trigger: "cron" });
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
