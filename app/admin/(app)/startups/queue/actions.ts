"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";

import { sbFetch } from "@/lib/admin/sb";
import { flashQs } from "@/lib/admin/flash";
import {
  countBrregRolesBacklog,
  findLiveBrregRolesDrainJob,
  insertBrregRolesDrainJob,
  markBrregRolesDrainCancelled,
  reapStaleBrregRolesDrains,
  runBrregRolesFullDrain,
} from "@/lib/admin/brreg-roles-drain";

function isRedirect(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "digest" in err);
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Drain the entire brreg_url_queue pending backlog in one click. Owns a
// single jobs row (enrich_brreg_roles_drain) and loops in CHUNK_SIZE
// batches until the queue is empty or the operator hits "Stopp
// drainering". Mirrors the Claude Tier 2 drain pattern. At BRREG's
// 250 ms polite pace, 130k rows ≈ 9 hours wall-clock; the drain is
// idempotent so a kiba-web restart mid-flight is recoverable by re-
// clicking the button. Cron at :12/:42 (K=50) handles steady-state.
export async function rolesBurstAction() {
  try {
    // Reap stale running rows (crashed without finalizing) before the
    // duplicate-guard check; otherwise an orphaned row blocks new drains.
    await reapStaleBrregRolesDrains(sbFetch);

    const live = await findLiveBrregRolesDrainJob(sbFetch);
    if (live) {
      redirect(
        `/admin/startups/queue${flashQs({
          error:
            'Rolle-drainering kjører allerede. Trykk "Stopp drainering" hvis du vil avbryte.',
        })}`,
      );
    }

    const backlog = await countBrregRolesBacklog(sbFetch);
    if (backlog === 0) {
      redirect(
        `/admin/startups/queue${flashQs({
          ok: "Ingen ventende rader — ingenting å draine.",
        })}`,
      );
    }

    const job = await insertBrregRolesDrainJob(sbFetch, backlog);

    // Fire-and-forget: returns immediately; the drain runs in the same
    // kiba-web container until the queue is empty (or cancelled).
    after(async () => {
      try {
        await runBrregRolesFullDrain({
          sb: sbFetch,
          jobId: job.id,
          initialBacklog: backlog,
        });
      } catch {
        // The orchestrator's try/catch finalizes the jobs row on any
        // unhandled error. This catch is a backstop only.
      }
    });

    redirect(
      `/admin/startups/queue${flashQs({
        ok: `Rolle-drainering startet (~${backlog.toLocaleString("nb-NO")} rader, ca. ${Math.ceil((backlog * 0.25) / 3600)} timer). Følg progresjon på /admin/processes.`,
      })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(
      `/admin/startups/queue${flashQs({
        error: `Kunne ikke starte: ${msg(err)}`,
      })}`,
    );
  }
}

export async function stopRolesDrainAction() {
  try {
    await markBrregRolesDrainCancelled(sbFetch);
    redirect(
      `/admin/startups/queue${flashQs({
        ok: "Stoppsignal sendt — drain avslutter etter neste rad.",
      })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(
      `/admin/startups/queue${flashQs({
        error: `Stopp feilet: ${msg(err)}`,
      })}`,
    );
  }
}

export async function retryFailedAction() {
  try {
    await sbFetch(`/brreg_url_queue?status=eq.failed`, {
      service: true,
      method: "PATCH",
      body: { status: "pending", attempts: 0, last_error: null },
      prefer: "return=minimal",
    });
    redirect(
      `/admin/startups/queue${flashQs({ ok: "Feilede rader satt tilbake til pending." })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(
      `/admin/startups/queue${flashQs({ error: `Tilbakestilling feilet: ${msg(err)}` })}`,
    );
  }
}

export async function discardFailedAction() {
  try {
    await sbFetch(`/brreg_url_queue?status=eq.failed`, {
      service: true,
      method: "DELETE",
      prefer: "return=minimal",
    });
    redirect(
      `/admin/startups/queue${flashQs({ ok: "Feilede rader forkastet." })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(
      `/admin/startups/queue${flashQs({ error: `Forkasting feilet: ${msg(err)}` })}`,
    );
  }
}
