// POST /admin/api/jobs/bruk-refresh-stats — bearer-authed cron entry point.
// Calls public.refresh_bruk_aggregate_snapshot() which truncates and rebuilds
// public.bruk_aggregate_snapshot in one transaction, then sweeps pending rows
// older than 30 days.
//
// Cron tick: */15 * * * * at offsets :02/:17/:32/:47 (validate against
// scripts/fetcher-crontab before committing the new line).
//
// Manual trigger from /admin/bruk's "Frisk opp nå" button hits the same
// handler.

export const runtime = "nodejs";

import { sbFetch } from "@/lib/admin/sb";
import { requireBearer } from "@/lib/admin/bearer";

export async function POST(req: Request) {
  const denied = requireBearer(req);
  if (denied) return denied;
  try {
    await sbFetch("/rpc/refresh_bruk_aggregate_snapshot", {
      service: true,
      method: "POST",
      body: {},
      prefer: "return=minimal",
      retryTransient: false,
    });
    return Response.json({ ok: true, refreshed_at: new Date().toISOString() });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
