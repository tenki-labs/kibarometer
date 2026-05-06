"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import {
  bootstrapBrreg,
  fetchBrreg,
} from "@/lib/admin/legacy/brreg.js";
import { reprocessBrregCompanies } from "@/lib/admin/legacy/brreg-reprocess.js";
import { runBrregTier1 } from "@/lib/admin/llm-brreg-tier1";
import { runBrregTier2 } from "@/lib/admin/llm-brreg-tier2";
import { sbFetch } from "@/lib/admin/sb";
import { flashQs } from "@/lib/admin/flash";

const SKIP_LABEL: Record<string, string> = {
  no_api_key: "MLX_API_KEY mangler",
  already_running: "Allerede i gang — hopper over",
  no_prompt: "Ingen aktiv prompt funnet",
  no_taxonomy: "Brreg-kategorier eller Tier 2-prompt mangler",
};

// fetchBrreg is fast (one date filter, one or two pages of 1000 each →
// usually <30 s). Await it so the operator sees the count in the flash.
// bootstrapBrreg can run for many minutes (200 MB stream + per-row
// upserts) — defer with after(). The legacy snapshot + roles-burst
// actions were removed in PR 7: snapshots are covered by the global
// "Refresh snapshots" button on /admin/processes (calls all three
// domains' RPCs), and the roles-burst route runs on cron (12,42 each
// hour) — operators who really need to force a tick can curl the
// route directly.

function isRedirect(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "digest" in err);
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function ingestAction(formData: FormData) {
  const fromDate = (formData.get("from") as string) || null;
  const toDate = (formData.get("to") as string) || null;
  try {
    const result = await fetchBrreg({
      sb: sbFetch,
      trigger: "manual",
      fromDate,
      toDate,
    });
    redirect(
      `/admin/startups${flashQs({
        ok: `Hentet ${result.fetched} foretak (${result.upserted} upserted, ${result.enqueued} til rolle-kø)`,
      })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(
      `/admin/startups${flashQs({ error: `Henting feilet: ${msg(err)}` })}`,
    );
  }
}

// Re-tag every brreg_companies row against the current keyword catalogue.
// Wraps reprocessBrregCompanies with a coordinator-row pattern (mirroring
// fastForwardAction in /admin/job-market/actions.ts) so the long-running
// scan gets a UI-visible banner + STOP support. Re-entrancy guard: only
// one drain at a time.
type BrregReprocessCoordinator = {
  id: string;
  metadata: Record<string, unknown> | null;
};

export async function reprocessKeywordsAction() {
  const running = await sbFetch<{ id: string }[]>(
    `/jobs?name=eq.brreg_reprocess_drain&status=eq.running&select=id&limit=1`,
    { service: true },
  );
  if (running.length > 0) {
    redirect(
      `/admin/startups${flashQs({ error: "Re-tagging kjører allerede." })}`,
    );
  }

  // Insert coordinator BEFORE redirect so the post-redirect render
  // already shows a running row (no dead-window flicker).
  const coordRows = await sbFetch<BrregReprocessCoordinator[]>(`/jobs`, {
    service: true,
    method: "POST",
    body: {
      name: "brreg_reprocess_drain",
      trigger: "manual",
      status: "running",
      metadata: {
        phase: "starting",
        drain_started_at: new Date().toISOString(),
      },
    },
    prefer: "return=representation",
  });
  const coordinator = coordRows[0];

  after(async () => {
    try {
      await reprocessBrregCompanies({
        sb: sbFetch,
        trigger: "manual",
        coordinatorId: coordinator.id,
      });
      // The orchestrator finished naturally — flip the coordinator
      // success unless STOP already moved it.
      const me = await sbFetch<{ status: string }[]>(
        `/jobs?id=eq.${coordinator.id}&select=status`,
        { service: true },
      );
      if (me[0]?.status === "running") {
        await sbFetch(`/jobs?id=eq.${coordinator.id}`, {
          service: true,
          method: "PATCH",
          body: {
            status: "success",
            finished_at: new Date().toISOString(),
            progress_pct: 100,
            current_step: "drain completed",
          },
          prefer: "return=minimal",
        });
      }
    } catch (err) {
      await sbFetch(`/jobs?id=eq.${coordinator.id}`, {
        service: true,
        method: "PATCH",
        body: {
          status: "failed",
          finished_at: new Date().toISOString(),
          error: String(err instanceof Error ? err.message : err).slice(
            0,
            1000,
          ),
        },
        prefer: "return=minimal",
      });
    }
  });

  redirect(
    `/admin/keywords${flashQs({
      ok: "Re-tagging av brreg-selskaper startet — se /admin/processes for status.",
    })}`,
  );
}

// STOP button for the keyword-reprocess drain. Same pattern as NAV's
// stopDrainAction: flip the coordinator to failed, the loop's pre-batch
// check sees status != running and bails after the current page.
export async function stopReprocessAction() {
  try {
    await sbFetch(
      `/jobs?name=eq.brreg_reprocess_drain&status=eq.running`,
      {
        service: true,
        method: "PATCH",
        body: {
          status: "failed",
          finished_at: new Date().toISOString(),
          error: "stopped by user",
        },
        prefer: "return=minimal",
      },
    );
    redirect(
      `/admin/startups${flashQs({
        ok: "Re-tagging stoppet. Pågående side fullfører før loopen slutter.",
      })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(
      `/admin/startups${flashQs({ error: `Stopp feilet: ${msg(err)}` })}`,
    );
  }
}

// Tier 1 burst — defer with after() so the action returns immediately
// while runBrregTier1 runs to completion. Same preflight skip-checks
// (no API key / already-running / no prompt) as NAV + media so we can
// flash a useful message before deferring the LLM loop.
export async function runTier1Action() {
  const skip = await llmPreflight("tier1");
  if (skip) {
    redirect(`/admin/startups${flashQs({ ok: skip })}`);
  }
  after(async () => {
    try {
      await runBrregTier1({ sb: sbFetch, trigger: "manual" });
    } catch {
      // runBrregTier1 writes its own failure PATCH to the jobs row.
    }
  });
  redirect(
    `/admin/startups${flashQs({
      ok: "Tier 1-batch startet — følg progresjon på /admin/processes.",
    })}`,
  );
}

export async function runTier2Action() {
  const skip = await llmPreflight("tier2");
  if (skip) {
    redirect(`/admin/startups${flashQs({ ok: skip })}`);
  }
  after(async () => {
    try {
      await runBrregTier2({ sb: sbFetch, trigger: "manual" });
    } catch {
      // runBrregTier2 writes its own failure PATCH to the jobs row.
    }
  });
  redirect(
    `/admin/startups${flashQs({
      ok: "Tier 2-batch startet — følg progresjon på /admin/processes.",
    })}`,
  );
}

// Cheap dry-fire that probes the same skip-paths the orchestrators
// check internally, before we defer the long-running LLM loop with
// after(). Avoids a 60 s wait before flashing "no api key" etc.
async function llmPreflight(
  tier: "tier1" | "tier2",
): Promise<string | null> {
  if (!process.env.MLX_API_KEY) return SKIP_LABEL.no_api_key;
  const jobName = tier === "tier1" ? "brreg_llm_tier1" : "brreg_llm_tier2";
  try {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const running = await sbFetch<{ id: string }[]>(
      `/jobs?name=eq.${jobName}&status=eq.running` +
        `&last_heartbeat=gt.${encodeURIComponent(cutoff)}&select=id&limit=1`,
      { service: true },
    );
    if (running.length > 0) return SKIP_LABEL.already_running;
  } catch {
    // If the probe fails, let the orchestrator handle it.
  }
  return null;
}

// Brreg backfill — full-registry bulk-dump load. Renamed from
// bootstrapAction in PR 7 to match the cross-domain "Backfill" label
// (NAV uses the same word). The floor-date input was removed in the
// same PR; backfill now always loads the full Brreg registry. The
// underlying lib function bootstrapBrreg() still resolves null floor
// to "no filter" — see lib/admin/legacy/brreg.js + migration 0033.
export async function backfillAction() {
  after(async () => {
    try {
      await bootstrapBrreg({ sb: sbFetch, trigger: "manual", floorDate: null });
    } catch {
      // bootstrapBrreg writes its own failure PATCH to the jobs row.
    }
  });
  redirect(
    `/admin/startups${flashQs({
      ok: "Backfill startet — laster hele Brreg-registeret. Kan ta 10-30 min. Følg status nedenfor.",
    })}`,
  );
}

