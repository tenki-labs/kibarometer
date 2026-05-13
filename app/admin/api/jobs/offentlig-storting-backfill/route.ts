// POST /admin/api/jobs/offentlig-storting-backfill — bearer-authed entry.
// Manual one-shot; NOT scheduled in the fetcher crontab. The /admin/offentlig
// admin UI (B2) wires a button to this endpoint to backfill historical
// sessions back to 2019-2020 (the first session that contains calendar 2020
// data — Stortinget years span October → September).
//
// Walks sessions in reverse-chronological order so the keyword catalog grown
// by Tier 1 on more recent sessions benefits older runs (Tier 1 is forward-
// only on live ingest; backfilled rows get the matcher's verdict from their
// ingest time and only flip after the next Sunday retag).
//
// Query params:
//   ?fromSession=YYYY-YYYY  (defaults to the current session)
//   ?toSession=YYYY-YYYY    (defaults to 2019-2020)
//
// The 7-session walk takes roughly 7 × (saker fetch + vedtak fetch + upserts)
// — back-of-envelope ~3–5 min total on the live Stortinget API. -m 1800 in
// future crontab/job wrappers gives generous slack.

export const runtime = "nodejs";

import { backfillStorting } from "@/lib/admin/legacy/storting.js";
import { sbFetch } from "@/lib/admin/sb";
import { requireBearer } from "@/lib/admin/bearer";

export async function POST(req: Request) {
  const denied = requireBearer(req);
  if (denied) return denied;
  try {
    const url = new URL(req.url);
    const fromSession = url.searchParams.get("fromSession") || null;
    const toSession = url.searchParams.get("toSession") || undefined;
    const result = await backfillStorting({
      sb: sbFetch,
      trigger: "manual",
      fromSession,
      toSession,
    });
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
