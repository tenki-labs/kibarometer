export const runtime = "nodejs";

import { archiveEnrichNav } from "@/lib/admin/legacy/nav-archive.js";
import { sbFetch } from "@/lib/admin/sb";
import { requireBearer } from "@/lib/admin/bearer";

// Every 15 min: recover descriptions for postings the feed API can no
// longer serve — live page first, then archived captures. 60 s wall.
export async function POST(req: Request) {
  const denied = requireBearer(req);
  if (denied) return denied;
  try {
    const result = await archiveEnrichNav({ sb: sbFetch, trigger: "cron" });
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
