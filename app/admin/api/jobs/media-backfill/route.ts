export const runtime = "nodejs";

import { runMediaBackfill } from "@/lib/admin/legacy/media-backfill.js";
import { sbFetch } from "@/lib/admin/sb";
import { requireBearer } from "@/lib/admin/bearer";

// Manual-only: there is no cron entry for media-backfill (per the PRD).
// The /admin/media/sources "Backfill" buttons fire the underlying server
// action which calls runMediaBackfill directly inside the request — this
// route exists only so an operator with the bearer token can trigger it
// from outside the admin UI (e.g. curl from a laptop while debugging).
//
// `source_id` comes via JSON body or query string.
export async function POST(req: Request) {
  const denied = requireBearer(req);
  if (denied) return denied;

  let sourceId: string | null = null;
  const url = new URL(req.url);
  sourceId = url.searchParams.get("source_id");

  if (!sourceId) {
    try {
      const body = (await req.json()) as { source_id?: string };
      sourceId = body?.source_id ?? null;
    } catch {
      // empty body — fall through to error below
    }
  }

  if (!sourceId) {
    return Response.json(
      { error: "source_id mangler (sett ?source_id=… eller send i JSON-body)" },
      { status: 400 },
    );
  }

  try {
    const result = await runMediaBackfill({
      sb: sbFetch,
      sourceId,
      trigger: "manual",
    });
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
