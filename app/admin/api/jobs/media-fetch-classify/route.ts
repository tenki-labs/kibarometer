export const runtime = "nodejs";

import { runFetchClassify } from "@/lib/admin/legacy/media-fetch-classify.js";
import { sbFetch } from "@/lib/admin/sb";
import { requireBearer } from "@/lib/admin/bearer";

export async function POST(req: Request) {
  const denied = requireBearer(req);
  if (denied) return denied;

  const settings = await sbFetch<{ cron_paused: boolean }[]>(
    `/app_settings?id=eq.1&select=cron_paused`,
    { service: true },
  );
  if (settings[0]?.cron_paused) {
    return Response.json({ status: "noop", reason: "cron_paused" });
  }

  try {
    const result = await runFetchClassify({ sb: sbFetch, trigger: "cron" });
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
