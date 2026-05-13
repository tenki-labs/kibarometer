"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";

import { drainFinancials } from "@/lib/admin/legacy/brreg-financials.js";
import {
  countBrregFinancialsBacklog,
  findLiveBrregFinancialsDrainJob,
  insertBrregFinancialsDrainJob,
  markBrregFinancialsDrainCancelled,
  reapStaleBrregFinancialsDrains,
  runBrregFinancialsFullDrain,
} from "@/lib/admin/brreg-financials-drain";
import { sbFetch } from "@/lib/admin/sb";
import { flashQs } from "@/lib/admin/flash";

function isRedirect(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "digest" in err);
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Manual drain trigger for /admin/startups/financials. Defers via after()
// since the K=50 burst can run for several wall-minutes and we want the
// flash to land immediately. The job row carries progress; operators
// follow /admin/processes for live status.
export async function triggerFinancialDrainAction(formData: FormData) {
  const kRaw = formData.get("k");
  const k = kRaw ? Math.max(1, Math.min(200, Number(kRaw) || 50)) : 50;
  after(async () => {
    try {
      await drainFinancials({ sb: sbFetch, trigger: "manual", k });
    } catch {
      // drainFinancials writes its own failure PATCH on the jobs row.
    }
  });
  redirect(
    `/admin/startups/financials${flashQs({
      ok: `Drain av ${k} foretak startet — følg /admin/processes for status.`,
    })}`,
  );
}

// Drain the entire AI-flagged candidate pool in one click. Owns a single
// jobs row (brreg_financials_full_drain) and loops in CHUNK_SIZE batches
// until the pool is empty or the operator hits "Stopp backfill". Mirrors
// rolesBurstAction. At BRREG's 250 ms polite pace + DB writes, ~21k orgnrs
// ≈ 3-5 hours wall-clock; idempotent so a kiba-web restart mid-flight is
// recoverable via the brreg-financials-watchdog cron at every :02-:57/5.
// Cron at :18 (K=50) handles steady-state going forward.
export async function financialsBurstAction() {
  try {
    await reapStaleBrregFinancialsDrains(sbFetch);

    const live = await findLiveBrregFinancialsDrainJob(sbFetch);
    if (live) {
      redirect(
        `/admin/startups/financials${flashQs({
          error:
            'Backfill kjører allerede. Trykk "Stopp backfill" hvis du vil avbryte.',
        })}`,
      );
    }

    const backlog = await countBrregFinancialsBacklog(sbFetch);
    if (backlog === 0) {
      redirect(
        `/admin/startups/financials${flashQs({
          ok: "Ingen kandidater — alle AI-flagga foretak er allerede hentet (eller siste forsøk er <180 dager gammelt).",
        })}`,
      );
    }

    const job = await insertBrregFinancialsDrainJob(sbFetch, backlog);

    after(async () => {
      try {
        await runBrregFinancialsFullDrain({
          sb: sbFetch,
          jobId: job.id,
          initialBacklog: backlog,
        });
      } catch {
        // Orchestrator's try/catch finalizes the jobs row on any
        // unhandled error. This catch is a backstop only.
      }
    });

    const etaHours = Math.max(1, Math.ceil((backlog * 0.5) / 3600));
    redirect(
      `/admin/startups/financials${flashQs({
        ok: `Backfill startet (~${backlog.toLocaleString("nb-NO")} foretak, ca. ${etaHours} timer). Følg progresjon på /admin/processes.`,
      })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(
      `/admin/startups/financials${flashQs({
        error: `Kunne ikke starte: ${msg(err)}`,
      })}`,
    );
  }
}

export async function stopFinancialsDrainAction() {
  try {
    await markBrregFinancialsDrainCancelled(sbFetch);
    redirect(
      `/admin/startups/financials${flashQs({
        ok: "Stoppsignal sendt — backfill avslutter etter neste rad.",
      })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(
      `/admin/startups/financials${flashQs({
        error: `Stopp feilet: ${msg(err)}`,
      })}`,
    );
  }
}

// Brreg-only snapshot refresh — same pattern as the /admin/startups
// refreshSnapshotsAction, but redirects back to /financials so the
// operator can immediately see the recomputed yearly + cohort rows.
export async function refreshFinancialSnapshotsAction() {
  try {
    await sbFetch("/rpc/refresh_all_brreg_snapshots", {
      service: true,
      method: "POST",
      body: {},
      prefer: "return=minimal",
    });
    redirect(
      `/admin/startups/financials${flashQs({ ok: "Brreg-snapshots regnet på nytt" })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(
      `/admin/startups/financials${flashQs({ error: msg(err) })}`,
    );
  }
}
