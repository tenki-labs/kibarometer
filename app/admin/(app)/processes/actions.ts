"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import {
  backfillNav,
  enrichNav,
  fetchNav,
  refreshSnapshots,
  reprocessNavPostings,
} from "@/lib/admin/legacy/jobs.js";
import {
  drainProgressPct,
  fastForwardNav,
  pastFFThreshold,
} from "@/lib/admin/legacy/fast-forward.js";
import { sbFetch } from "@/lib/admin/sb";
import { flashQs } from "@/lib/admin/flash";

type BackfillMeta = {
  next_cursor?: string | null;
  tail_cursor?: string | null;
  completed?: boolean;
  last_event_at?: string | null;
};

// fetchNav is a single-page poll — finishes in a few seconds, so we still
// await it and report rows_processed in the flash. The other orchestrators
// can run for up to 60 s, which exceeds the implicit server-action timeout
// behind Caddy/Next 16; we defer them with `after()` so the action returns
// immediately and the orchestrator finishes in-process. Each orchestrator
// already writes its own success/failure PATCH to the jobs row.

export async function fetchAction() {
  try {
    const result = await fetchNav({ sb: sbFetch, trigger: "manual" });
    redirect(
      `/admin/processes${flashQs({ ok: `Hentet ${result.rows_processed} stillinger` })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(
      `/admin/processes${flashQs({ error: `Henting feilet: ${msg(err)}` })}`,
    );
  }
}

export async function backfillAction() {
  after(async () => {
    try {
      await backfillNav({ sb: sbFetch, trigger: "manual" });
    } catch {
      // backfillNav writes its own failure PATCH to the jobs row.
    }
  });
  redirect(
    `/admin/processes${flashQs({ ok: "Backfill startet — se status nedenfor." })}`,
  );
}

export async function enrichAction() {
  after(async () => {
    try {
      await enrichNav({ sb: sbFetch, trigger: "manual" });
    } catch {
      // enrichNav writes its own failure PATCH to the jobs row.
    }
  });
  redirect(
    `/admin/processes${flashQs({ ok: "Berikelse startet — se status nedenfor." })}`,
  );
}

export async function reprocessAction() {
  after(async () => {
    try {
      await reprocessNavPostings({ sb: sbFetch, trigger: "manual" });
    } catch {
      // reprocessNavPostings writes its own failure PATCH to the jobs row.
    }
  });
  redirect(
    `/admin/keywords${flashQs({ ok: "Re-tagging startet — se /admin/processes for status." })}`,
  );
}

// BACKFILL button on /admin/processes. One click drains NAV's feed from
// wherever the cursor sits to live head, in two phases:
//   1. Fast-forward (no-op onPage) while last_event_at < FF_THRESHOLD.
//      Skips NAV's 2023 migration burst — those events are about
//      historical postings we don't ingest (per product decision).
//   2. Catch-up (full ingestion via backfillNav) once past the
//      threshold. Stops when metadata.completed becomes true.
//
// The drain is owned by a single coordinator job row
// (`name='backfill_drain'`) inserted SYNCHRONOUSLY here before the
// redirect — that closes the dead window where the page would
// otherwise re-render with no `running` row visible. The coordinator
// stays `running` for the whole drain (~3 h, ~200 batches) so the UI
// banner + AutoRefresh stay anchored across batch transitions.
//
// Per-batch `backfill_nav_stillingsfeed` rows still get inserted by
// each orchestrator call below and own the cursor metadata that the
// next batch's prev lookup inherits.
//
// Cron during drain is short-circuited by the route handler (see
// /admin/api/jobs/backfill-nav/route.ts) so the two paths can't race.
type DrainCoordinator = {
  id: string;
  metadata: Record<string, unknown> | null;
};

type BatchSummary = {
  last_event_at?: string | null;
};

export async function fastForwardAction() {
  // Re-entrancy guard at the coordinator level — one drain at a time.
  const running = await sbFetch<{ id: string }[]>(
    `/jobs?name=eq.backfill_drain&status=eq.running&select=id&limit=1`,
    { service: true },
  );
  if (running.length > 0) {
    redirect(
      `/admin/processes${flashQs({ error: "Backfill kjører allerede." })}`,
    );
  }

  // Insert coordinator BEFORE redirect so the post-redirect page render
  // already sees a running row. Closes the dead window.
  const coordinatorRows = await sbFetch<DrainCoordinator[]>(`/jobs`, {
    service: true,
    method: "POST",
    body: {
      name: "backfill_drain",
      trigger: "manual",
      status: "running",
      metadata: {
        phase: "starting",
        drain_started_at: new Date().toISOString(),
        batches_completed: 0,
      },
    },
    prefer: "return=representation",
  });
  const coordinator = coordinatorRows[0];

  after(async () => {
    let batches = 0;
    let lastBatchSummary: BatchSummary | null = null;
    try {
      while (true) {
        // Honor STOP button: bail if the coordinator was cancelled.
        const me = await sbFetch<{ status: string }[]>(
          `/jobs?id=eq.${coordinator.id}&select=status`,
          { service: true },
        );
        if (me[0]?.status !== "running") return;

        const prev = await sbFetch<{ metadata: BackfillMeta | null }[]>(
          `/jobs?name=eq.backfill_nav_stillingsfeed&status=eq.success` +
            `&order=started_at.desc&limit=1&select=metadata`,
          { service: true },
        );
        const meta = prev[0]?.metadata ?? null;
        if (meta?.completed) break;

        const phase = pastFFThreshold(meta?.last_event_at)
          ? "catch-up"
          : "fast-forward";

        // Heartbeat the coordinator before the batch starts so the UI
        // shows current phase/progress while the batch wall-time runs.
        await sbFetch(`/jobs?id=eq.${coordinator.id}`, {
          service: true,
          method: "PATCH",
          body: {
            last_heartbeat: new Date().toISOString(),
            current_step: `${phase} batch ${batches + 1} (last event: ${meta?.last_event_at ?? "—"})`,
            progress_pct: drainProgressPct(meta?.last_event_at ?? null),
            metadata: {
              phase,
              drain_started_at:
                (coordinator.metadata?.drain_started_at as string | undefined) ??
                new Date().toISOString(),
              batches_completed: batches,
              last_event_at: meta?.last_event_at ?? null,
            },
          },
        });

        lastBatchSummary =
          phase === "catch-up"
            ? ((await backfillNav({
                sb: sbFetch,
                trigger: "fast-forward",
              })) as BatchSummary)
            : ((await fastForwardNav({
                sb: sbFetch,
                trigger: "fast-forward",
              })) as BatchSummary);
        batches += 1;
      }

      // Caught up to live head. Terminate coordinator success.
      await sbFetch(`/jobs?id=eq.${coordinator.id}`, {
        service: true,
        method: "PATCH",
        body: {
          status: "success",
          finished_at: new Date().toISOString(),
          progress_pct: 100,
          current_step: "drain completed",
          metadata: {
            phase: "completed",
            drain_started_at:
              (coordinator.metadata?.drain_started_at as string | undefined) ??
              null,
            batches_completed: batches,
            last_event_at: lastBatchSummary?.last_event_at ?? null,
          },
        },
      });
    } catch (err) {
      await sbFetch(`/jobs?id=eq.${coordinator.id}`, {
        service: true,
        method: "PATCH",
        body: {
          status: "failed",
          finished_at: new Date().toISOString(),
          error: String(err instanceof Error ? err.message : err).slice(0, 1000),
        },
      });
    }
  });

  redirect(
    `/admin/processes${flashQs({ ok: "Backfill startet — se status nedenfor." })}`,
  );
}

// STOP DRAIN button — flips the coordinator row to failed. The loop's
// pre-batch status check (above) sees status != 'running' on its next
// iteration and returns. The in-flight per-batch row finishes its
// current wall budget (≤60 s) and writes its own terminal PATCH, then
// the loop exits. We deliberately don't touch the per-batch row to
// avoid racing with the orchestrator's own write.
export async function stopDrainAction() {
  try {
    await sbFetch(`/jobs?name=eq.backfill_drain&status=eq.running`, {
      service: true,
      method: "PATCH",
      body: {
        status: "failed",
        finished_at: new Date().toISOString(),
        error: "stopped by user",
      },
    });
    redirect(
      `/admin/processes${flashQs({
        ok: "Backfill stoppet. Pågående batch fullfører før loopen slutter.",
      })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`/admin/processes${flashQs({ error: `Stopp feilet: ${msg(err)}` })}`);
  }
}

// Cron toggle on /admin/processes. Flips app_settings.cron_paused. The
// kiba-fetcher crontab still ticks at its scheduled time; the route
// handler reads this flag and noops when paused.
export async function toggleCronPausedAction() {
  try {
    const current = await sbFetch<{ cron_paused: boolean }[]>(
      `/app_settings?id=eq.1&select=cron_paused`,
      { service: true },
    );
    const next = !current[0]?.cron_paused;
    await sbFetch(`/app_settings?id=eq.1`, {
      service: true,
      method: "PATCH",
      body: { cron_paused: next, updated_at: new Date().toISOString() },
    });
    redirect(
      `/admin/processes${flashQs({
        ok: next ? "Daglig henting pauset." : "Daglig henting aktivert.",
      })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(
      `/admin/processes${flashQs({ error: `Toggle feilet: ${msg(err)}` })}`,
    );
  }
}

export async function refreshSnapshotsAction() {
  after(async () => {
    try {
      await refreshSnapshots({ sb: sbFetch, trigger: "manual" });
    } catch {
      // refreshSnapshots writes its own failure PATCH to the jobs row.
    }
  });
  redirect(
    `/admin/processes${flashQs({ ok: "Snapshot-refresh startet — se status nedenfor." })}`,
  );
}

// Next's `redirect()` throws a special error with `digest === "NEXT_REDIRECT"`
// — re-throw it so the redirect actually happens, otherwise we'd swallow it
// in the catch and turn the success flash into an error flash.
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
