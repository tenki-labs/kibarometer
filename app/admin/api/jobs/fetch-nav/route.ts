// POST /admin/api/jobs/fetch-nav — bearer-authed cron entry point.
// Mirrors scripts/admin-server.js's BEARER_HANDLERS["/admin/api/jobs/fetch-nav"].

export const runtime = "nodejs";

import { fetchNav } from "@/lib/admin/legacy/jobs.js";
import { sbFetch } from "@/lib/admin/sb";
import { requireBearer } from "@/lib/admin/bearer";

export async function POST(req: Request) {
  const denied = requireBearer(req);
  if (denied) return denied;
  try {
    const result = await fetchNav({ sb: sbFetch, trigger: "cron" });
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
