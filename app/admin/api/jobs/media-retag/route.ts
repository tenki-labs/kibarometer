// POST /admin/api/jobs/media-retag — bearer-authed cron entry point.
// Calls reprocessMediaArticles which re-applies the current canonical
// media keyword matcher (headline-only haystack — see media-reprocess.js
// doc-comment for why) to every media_articles row.
//
// Unlike brreg-retag / nav reprocess, this orchestrator does NOT chain
// into a snapshot refresh. The cron is scheduled Sundays 03:40 UTC so
// the daily media-refresh-snapshots tick at 04:30 picks up the new tags
// the same morning.
//
// Cron tick: 40 3 * * 0. Mirror of /admin/api/jobs/brreg-retag (Sun 05:15)
// and /admin/api/jobs/reprocess (NAV, Sun 03:30).

export const runtime = "nodejs";

import { reprocessMediaArticles } from "@/lib/admin/legacy/media-reprocess.js";
import { sbFetch } from "@/lib/admin/sb";
import { requireBearer } from "@/lib/admin/bearer";

export async function POST(req: Request) {
  const denied = requireBearer(req);
  if (denied) return denied;
  try {
    const result = await reprocessMediaArticles({
      sb: sbFetch,
      trigger: "cron",
    });
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
