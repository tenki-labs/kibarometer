"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";

import { flashQs } from "@/lib/admin/flash";
import { sbFetch } from "@/lib/admin/sb";
import { runMediaTier1 } from "@/lib/admin/llm-media-tier1";
import { runMediaTier2 } from "@/lib/admin/llm-media-tier2";
import { runFetchClassify } from "@/lib/admin/legacy/media-fetch-classify.js";

const LIST = "/admin/media/queue";

const BURST_K_TIER1 = 100;
const BURST_K_TIER2 = 20;
const BURST_K_FETCH = 200;
const BURST_WALL_MS = 4 * 60_000;

const SKIP_LABEL: Record<string, string> = {
  no_api_key: "MLX_API_KEY mangler",
  already_running: "Allerede i gang — hopper over",
  no_prompt: "Ingen aktiv prompt funnet",
};

// Three drain buttons that mirror the inline ones in /admin/media's
// Pipelinedybde card — same orchestrators, different surface. Operators
// who land on the queue page after a backfill drain can flush the queue
// without bouncing back to the hub.

export async function burstFetchClassifyAction() {
  try {
    const r = (await runFetchClassify({
      sb: sbFetch,
      trigger: "manual",
      k: BURST_K_FETCH,
      maxWallMs: BURST_WALL_MS,
    })) as {
      status: string;
      reason?: string;
      processed?: number;
      ai_relevant?: number;
      stopped?: string;
    };
    const parts = [
      `Fetch+klassifiser: ${r.processed ?? 0} URL-er prosessert`,
      r.ai_relevant != null ? `${r.ai_relevant} AI-treff` : null,
      r.stopped ? `(stoppet: ${r.stopped})` : null,
    ].filter(Boolean);
    redirect(`${LIST}${flashQs({ ok: parts.join(" · ") })}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`${LIST}${flashQs({ error: msg(err) })}`);
  }
}

export async function burstTier1Action() {
  const skip = await llmPreflight("media_tier1");
  if (skip) {
    redirect(`${LIST}${flashQs({ ok: skip })}`);
  }
  after(async () => {
    try {
      await runMediaTier1({
        sb: sbFetch,
        trigger: "manual",
        k: BURST_K_TIER1,
        wallTimeMs: BURST_WALL_MS,
      });
    } catch {
      // runMediaTier1 writes its own failure PATCH to the jobs row.
    }
  });
  redirect(
    `${LIST}${flashQs({
      ok: "Tier 1-burst startet — følg progresjon på /admin/processes.",
    })}`,
  );
}

export async function burstTier2Action() {
  const skip = await llmPreflight("media_tier2");
  if (skip) {
    redirect(`${LIST}${flashQs({ ok: skip })}`);
  }
  after(async () => {
    try {
      await runMediaTier2({
        sb: sbFetch,
        trigger: "manual",
        k: BURST_K_TIER2,
        wallTimeMs: BURST_WALL_MS,
      });
    } catch {
      // runMediaTier2 writes its own failure PATCH to the jobs row.
    }
  });
  redirect(
    `${LIST}${flashQs({
      ok: "Tier 2-burst startet — følg progresjon på /admin/processes.",
    })}`,
  );
}

async function llmPreflight(
  role: "media_tier1" | "media_tier2",
): Promise<string | null> {
  if (!process.env.MLX_API_KEY) return SKIP_LABEL.no_api_key;
  const jobName = role === "media_tier1" ? "media_llm_tier1" : "media_llm_tier2";
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

// Reset a failed row back to pending so the next fetch-classify tick
// retries it. Resets attempts to 0 so the operator gets a clean attempt.
export async function retryQueueAction(id: string) {
  try {
    await sbFetch(`/media_url_queue?id=eq.${encodeURIComponent(id)}`, {
      service: true,
      method: "PATCH",
      body: { status: "pending", attempts: 0, last_error: null },
      prefer: "return=minimal",
    });
    redirect(`${LIST}${flashQs({ ok: "Re-køet" })}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`${LIST}${flashQs({ error: msg(err) })}`);
  }
}

// Bulk-reset every failed row older than 7 days. Operator escape hatch
// for a queue full of dead URLs (404s, paywalls, retired domains).
export async function discardOldFailedAction() {
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const deleted = await sbFetch<{ id: string }[]>(
      `/media_url_queue?status=eq.failed&discovered_at=lt.${encodeURIComponent(cutoff)}`,
      {
        service: true,
        method: "DELETE",
        prefer: "return=representation",
      },
    );
    redirect(
      `${LIST}${flashQs({
        ok: `Slettet ${deleted.length} feilede rader eldre enn 7 dager`,
      })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`${LIST}${flashQs({ error: msg(err) })}`);
  }
}

function isRedirect(err: unknown): boolean {
  return (
    err instanceof Error &&
    "digest" in err &&
    typeof (err as { digest: unknown }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
