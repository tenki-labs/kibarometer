export const runtime = "nodejs";

// Nightly snapshot refresh for the media pipeline. Calls the SQL
// orchestrator refresh_all_media_snapshots() (defined in 0029_media.sql),
// which truncate-inserts the five snapshot tables in one transaction.
// Cron runs at 04:30 UTC, offset from refresh_all_snapshots at 04:00.

import { sbFetch } from "@/lib/admin/sb";
import { requireBearer } from "@/lib/admin/bearer";

export async function POST(req: Request) {
  const denied = requireBearer(req);
  if (denied) return denied;
  try {
    await sbFetch("/rpc/refresh_all_media_snapshots", {
      service: true,
      method: "POST",
      body: {},
      prefer: "return=minimal",
    });
    return Response.json({ status: "success" });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
