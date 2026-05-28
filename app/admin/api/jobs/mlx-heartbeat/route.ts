// POST /admin/api/jobs/mlx-heartbeat — fired every 5 min by kiba-fetcher.
// Cheap GET against mlx.tenki.no/v1/models so /admin/llm's "Tunnel" badge
// reflects actual tunnel reachability rather than LLM work volume. Without
// this, the badge ages out to "Utilgjengelig" (red) whenever all four
// pillars' Tier 1/Tier 2 queues are empty for 30 min — even though the
// endpoint is fine. mlxPing() already writes mlx_health.last_success_at
// on 200 and last_failure_at on auth/HTTP/network error, so the page-side
// classifier picks up the heartbeat automatically. No-op when MLX_API_KEY
// is unset (mlxPing returns ok=false without DB writes — same silent
// convention as the Tier crons).

export const runtime = "nodejs";

import { mlxPing } from "@/lib/admin/mlx";
import { requireBearer } from "@/lib/admin/bearer";

export async function POST(req: Request) {
  const denied = requireBearer(req);
  if (denied) return denied;
  const result = await mlxPing();
  return Response.json(result);
}
