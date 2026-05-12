// POST /admin/api/jobs/offentlig-storting-retag — bearer-authed cron entry.
// Weekly Sunday 04:15 UTC tick. Re-applies the current canonical keyword
// matcher to every storting_saker + storting_vedtak row so historical
// rows pick up keyword catalog growth (same pattern as NAV's Sunday
// reprocess at 03:30).
//
// Total corpus is ~tens of thousands of rows across 8 sessions — one run
// completes in a few minutes; -m 600 in the crontab gives ample slack.

export const runtime = "nodejs";

import { retagStorting } from "@/lib/admin/legacy/storting.js";
import { sbFetch } from "@/lib/admin/sb";
import { requireBearer } from "@/lib/admin/bearer";

export async function POST(req: Request) {
  const denied = requireBearer(req);
  if (denied) return denied;
  try {
    const result = await retagStorting({
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
