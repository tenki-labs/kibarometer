export const runtime = "nodejs";

import { backfillNav } from "@/lib/admin/legacy/jobs.js";
import { sbFetch } from "@/lib/admin/sb";
import { requireBearer } from "@/lib/admin/bearer";

export async function POST(req: Request) {
  const denied = requireBearer(req);
  if (denied) return denied;

  // Soft pause: operator toggled cron off via /admin/processes. The cron in
  // kiba-fetcher still ticks at its scheduled time; this short-circuit
  // keeps the route's response time low.
  const settings = await sbFetch<{ cron_paused: boolean }[]>(
    `/app_settings?id=eq.1&select=cron_paused`,
    { service: true },
  );
  if (settings[0]?.cron_paused) {
    return Response.json({ status: "noop", reason: "cron_paused" });
  }

  // Don't compete with an in-flight button-driven drain. Check the
  // coordinator row (`backfill_drain`) — it stays `running` across the
  // whole drain even between batch transitions, so this short-circuit
  // works during the dead window between batches too. The previous
  // per-batch check missed ticks that landed in those gaps.
  const drainRunning = await sbFetch<{ id: string }[]>(
    `/jobs?name=eq.backfill_drain&status=eq.running&select=id&limit=1`,
    { service: true },
  );
  if (drainRunning.length > 0) {
    return Response.json({ status: "noop", reason: "drain_in_progress" });
  }

  try {
    const result = await backfillNav({ sb: sbFetch, trigger: "cron" });
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
