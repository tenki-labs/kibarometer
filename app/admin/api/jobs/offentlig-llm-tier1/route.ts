// POST /admin/api/jobs/offentlig-llm-tier1 — bearer-authed cron entry.
// Tier 1 (verbatim AI-phrase extraction) for the /offentlig pillar.
//
// Currently calls only the Stortinget half — Doffin tier1 lands once
// DFØ API access is in hand and lib/admin/llm-doffin-tier1.ts ships in a
// later PR. When that happens, this handler will call both in turn (same
// pattern as media's per-source ticks where one route drains multiple
// queues sequentially).
//
// Forward-only on ingest_mode='live' per the catalog-growth pattern from
// CLAUDE.md §2 — backfilled rows get categorized by Tier 2 but not
// phrase-extracted.

export const runtime = "nodejs";

import { runStortingTier1 } from "@/lib/admin/llm-storting-tier1";
import { sbFetch } from "@/lib/admin/sb";
import { requireBearer } from "@/lib/admin/bearer";

export async function POST(req: Request) {
  const denied = requireBearer(req);
  if (denied) return denied;
  try {
    const storting = await runStortingTier1({ sb: sbFetch, trigger: "cron" });
    return Response.json({ storting });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
