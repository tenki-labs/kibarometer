export const runtime = "nodejs";

import { archiveIndexNav } from "@/lib/admin/legacy/nav-archive.js";
import { sbFetch } from "@/lib/admin/sb";
import { requireBearer } from "@/lib/admin/bearer";

// Weekly: refresh nav_archive_index from Common Crawl + Wayback listings.
// Long-running (minutes) — the crontab gives it -m 1800.
export async function POST(req: Request) {
  const denied = requireBearer(req);
  if (denied) return denied;
  try {
    const result = await archiveIndexNav({ sb: sbFetch, trigger: "cron" });
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
