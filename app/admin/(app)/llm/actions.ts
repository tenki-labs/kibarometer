"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";

import { flashQs } from "@/lib/admin/flash";
import { runClassify } from "@/lib/admin/llm-classify";
import { runDiscover } from "@/lib/admin/llm-discover";
import { mlxPing } from "@/lib/admin/mlx";
import { sbFetch } from "@/lib/admin/sb";

const SKIP_LABEL: Record<string, string> = {
  no_api_key: "MLX_API_KEY mangler",
  already_running: "Allerede i gang — hopper over",
  no_prompt: "Ingen aktiv prompt funnet",
  no_taxonomy: "Taksonomi eller Tier 2-prompt mangler",
};

export async function pingAction() {
  try {
    const result = await mlxPing();
    if (result.ok) {
      redirect(
        `/admin/llm${flashQs({
          ok: result.modelId
            ? `Ping OK · modell: ${result.modelId}`
            : "Ping OK",
        })}`,
      );
    }
    redirect(
      `/admin/llm${flashQs({
        error: result.error ?? "Ukjent feil",
      })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(
      `/admin/llm${flashQs({
        error: msg(err),
      })}`,
    );
  }
}

// Tier 1 batch — defer with after() so the action returns immediately while
// the orchestrator runs to completion in-process. runDiscover writes its own
// jobs row on success/failure, so the user can follow progress on /admin/processes
// even after this action redirects. Same shape as backfillAction in
// app/admin/(app)/jobs/actions.ts.
export async function runTier1Action() {
  // Run synchronously through the skip-checks so we can flash a useful
  // message ("already running" / "no api key" / "no prompt"). Only the
  // long-running per-row LLM loop happens after().
  const cfgCheck = await preflight("tier1");
  if (cfgCheck.skip) {
    redirect(`/admin/llm${flashQs({ ok: cfgCheck.skip })}`);
  }
  after(async () => {
    try {
      await runDiscover({ sb: sbFetch, trigger: "manual" });
    } catch {
      // runDiscover writes its own failure PATCH to the jobs row.
    }
  });
  redirect(
    `/admin/llm${flashQs({
      ok: "Tier 1-batch startet — følg progresjon på /admin/processes.",
    })}`,
  );
}

export async function runTier2Action() {
  const cfgCheck = await preflight("tier2");
  if (cfgCheck.skip) {
    redirect(`/admin/llm${flashQs({ ok: cfgCheck.skip })}`);
  }
  after(async () => {
    try {
      await runClassify({ sb: sbFetch, trigger: "manual" });
    } catch {
      // runClassify writes its own failure PATCH to the jobs row.
    }
  });
  redirect(
    `/admin/llm${flashQs({
      ok: "Tier 2-batch startet — følg progresjon på /admin/processes.",
    })}`,
  );
}

// Pre-flight check that probes the same skip-paths the orchestrators check
// internally so we can surface a useful flash before deferring with after().
// Calling runDiscover/runClassify directly here would wait for the full
// 60 s LLM loop before we can redirect; this is a cheap dry-fire instead.
async function preflight(
  tier: "tier1" | "tier2",
): Promise<{ skip: string | null }> {
  if (!process.env.MLX_API_KEY) return { skip: SKIP_LABEL.no_api_key };

  const jobName = tier === "tier1" ? "llm-discover" : "llm-classify";
  try {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const running = await sbFetch<{ id: string }[]>(
      `/jobs?name=eq.${jobName}&status=eq.running` +
        `&last_heartbeat=gt.${encodeURIComponent(cutoff)}&select=id&limit=1`,
      { service: true },
    );
    if (running.length > 0) return { skip: SKIP_LABEL.already_running };
  } catch {
    // If the probe itself fails, let the orchestrator handle it.
  }
  return { skip: null };
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
