export const runtime = "nodejs";

import { backfillNav } from "@/lib/admin/legacy/jobs.js";
import { sbFetch } from "@/lib/admin/sb";
import { requireBearer } from "@/lib/admin/bearer";

export async function POST(req: Request) {
  const denied = requireBearer(req);
  if (denied) return denied;

  // Soft pause: operator toggled cron off via /admin/jobs. The cron in
  // kiba-fetcher still ticks at its scheduled time; this short-circuit
  // keeps the route's response time low.
  const settings = await sbFetch<{ cron_paused: boolean }[]>(
    `/app_settings?id=eq.1&select=cron_paused`,
    { service: true },
  );
  if (settings[0]?.cron_paused) {
    return Response.json({ status: "noop", reason: "cron_paused" });
  }

  // Don't compete with an in-flight button-driven drain. The drain
  // (fastForwardAction) loops continuously inserting trigger=
  // 'fast-forward' rows; a concurrent cron-triggered run would inherit
  // the same start cursor and waste a batch of duplicate work.
  const running = await sbFetch<{ id: string }[]>(
    `/jobs?name=eq.backfill_nav_stillingsfeed&status=eq.running` +
      `&trigger=eq.fast-forward&select=id&limit=1`,
    { service: true },
  );
  if (running.length > 0) {
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
