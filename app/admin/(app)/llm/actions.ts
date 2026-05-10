"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";

import { flashQs } from "@/lib/admin/flash";
import { mlxPing } from "@/lib/admin/mlx";
import { getStaffClaims } from "@/lib/admin/auth";
import { sbFetch } from "@/lib/admin/sb";
import { anthropicConfigured } from "@/lib/admin/anthropic";
import {
  NAV_CLAUDE_JOB_NAME,
  countNavTier2Backlog,
  findLiveClaudeDrainJob,
  insertClaudeDrainJob,
  markClaudeDrainCancelled,
  reapStaleClaudeDrains,
  runClassifyClaudeFullDrain,
} from "@/lib/admin/llm-classify-claude";
import {
  BRREG_CLAUDE_JOB_NAME,
  countBrregTier2Backlog,
  findLiveBrregClaudeDrainJob,
  insertBrregClaudeDrainJob,
  markBrregClaudeDrainCancelled,
  reapStaleBrregClaudeDrains,
  runBrregTier2ClaudeFullDrain,
} from "@/lib/admin/llm-brreg-tier2-claude";

// /admin/llm is the cross-pipeline LLM-health (diagnostics) surface. The
// Tier 1 / Tier 2 burst triggers moved to /admin/job-market in PR 2 so each
// pipeline's manual triggers live on its own hub. This page keeps the
// connectivity ping only — it's the only action that's actually about
// "the LLM endpoint" rather than "this pipeline's queue".

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

// Manual Claude-API backfill drains. Single click → background drain
// runs the entire pending Tier 2 backlog for the chosen pillar through
// Anthropic Haiku 4.5 with prompt caching + p-limit concurrency. The
// orchestrator writes a `jobs` row that /admin/llm reads to render
// in-flight progress; refresh the page to see the latest state.

type Pillar = "nav" | "brreg";

function pillarFromForm(formData: FormData): Pillar | null {
  const v = formData.get("pillar");
  if (v === "nav" || v === "brreg") return v;
  return null;
}

export async function startClaudeDrainAction(formData: FormData) {
  try {
    const claims = await getStaffClaims();
    if (!claims) redirect(`/admin/login?next=/admin/llm`);

    const pillar = pillarFromForm(formData);
    if (!pillar) {
      redirect(`/admin/llm${flashQs({ error: "Ugyldig domene" })}`);
    }

    if (!anthropicConfigured()) {
      redirect(
        `/admin/llm${flashQs({
          error: "ANTHROPIC_API_KEY mangler — kan ikke starte drain.",
        })}`,
      );
    }

    // Reap stale runs first (crashed without finalizing). Idempotent;
    // safe to run on every click.
    if (pillar === "nav") {
      await reapStaleClaudeDrains(sbFetch, NAV_CLAUDE_JOB_NAME);
    } else {
      await reapStaleBrregClaudeDrains(sbFetch);
    }

    const live =
      pillar === "nav"
        ? await findLiveClaudeDrainJob(sbFetch, NAV_CLAUDE_JOB_NAME)
        : await findLiveBrregClaudeDrainJob(sbFetch);
    if (live) {
      redirect(
        `/admin/llm${flashQs({
          error: `Drainering pågår allerede for ${pillar.toUpperCase()}. Trykk "Stopp drainering" hvis du vil avbryte.`,
        })}`,
      );
    }

    const backlog =
      pillar === "nav"
        ? await countNavTier2Backlog(sbFetch)
        : await countBrregTier2Backlog(sbFetch);
    if (backlog === 0) {
      redirect(
        `/admin/llm${flashQs({
          ok: `Ingen rader i ${pillar.toUpperCase()}-køen — ingenting å draine.`,
        })}`,
      );
    }

    const job =
      pillar === "nav"
        ? await insertClaudeDrainJob(sbFetch, NAV_CLAUDE_JOB_NAME, backlog)
        : await insertBrregClaudeDrainJob(sbFetch, backlog);

    // Fire-and-forget: returns immediately; the drain runs in the same
    // kiba-web container until the queue is empty (or cancelled).
    after(async () => {
      try {
        if (pillar === "nav") {
          await runClassifyClaudeFullDrain({
            sb: sbFetch,
            jobId: job.id,
            initialBacklog: backlog,
          });
        } else {
          await runBrregTier2ClaudeFullDrain({
            sb: sbFetch,
            jobId: job.id,
            initialBacklog: backlog,
          });
        }
      } catch {
        // The orchestrator's try/catch finalizes the jobs row on any
        // unhandled error. This catch is a backstop only.
      }
    });

    redirect(
      `/admin/llm${flashQs({
        ok: `Drainering startet for ${pillar.toUpperCase()} (~${backlog} rader). Last siden på nytt for å se fremgang.`,
      })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(
      `/admin/llm${flashQs({ error: `Kunne ikke starte: ${msg(err)}` })}`,
    );
  }
}

export async function stopClaudeDrainAction(formData: FormData) {
  try {
    const claims = await getStaffClaims();
    if (!claims) redirect(`/admin/login?next=/admin/llm`);

    const pillar = pillarFromForm(formData);
    if (!pillar) {
      redirect(`/admin/llm${flashQs({ error: "Ugyldig domene" })}`);
    }

    if (pillar === "nav") {
      await markClaudeDrainCancelled(sbFetch, NAV_CLAUDE_JOB_NAME);
    } else {
      await markBrregClaudeDrainCancelled(sbFetch);
    }

    redirect(
      `/admin/llm${flashQs({
        ok: `Stopper ${pillar.toUpperCase()}-drainering ved neste chunk.`,
      })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(
      `/admin/llm${flashQs({ error: `Stopp feilet: ${msg(err)}` })}`,
    );
  }
}
