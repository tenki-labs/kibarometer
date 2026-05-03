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
      `/admin/jobs${flashQs({ ok: `Hentet ${result.rows_processed} stillinger` })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(
      `/admin/jobs${flashQs({ error: `Henting feilet: ${msg(err)}` })}`,
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
    `/admin/jobs${flashQs({ ok: "Backfill startet — se status nedenfor." })}`,
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
    `/admin/jobs${flashQs({ ok: "Berikelse startet — se status nedenfor." })}`,
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
    `/admin/keywords${flashQs({ ok: "Re-tagging startet — se /admin/jobs for status." })}`,
  );
}

// BACKFILL button on /admin/jobs. One click drains NAV's feed from
// wherever the cursor sits to live head, in two phases:
//   1. Fast-forward (no-op onPage) while last_event_at < FF_THRESHOLD.
//      Skips NAV's 2023 migration burst — those events are about
//      historical postings we don't ingest (per product decision).
//   2. Catch-up (full ingestion via backfillNav) once past the
//      threshold. Stops when metadata.completed becomes true.
// Cron during drain is short-circuited by the route handler (see
// /admin/api/jobs/backfill-nav/route.ts) so the two paths can't race.
export async function fastForwardAction() {
  const running = await sbFetch<{ id: string }[]>(
    `/jobs?name=eq.backfill_nav_stillingsfeed&status=eq.running` +
      `&trigger=eq.fast-forward&select=id&limit=1`,
    { service: true },
  );
  if (running.length > 0) {
    redirect(
      `/admin/jobs${flashQs({ error: "Backfill kjører allerede." })}`,
    );
  }

  after(async () => {
    try {
      while (true) {
        const prev = await sbFetch<{ metadata: BackfillMeta | null }[]>(
          `/jobs?name=eq.backfill_nav_stillingsfeed&status=eq.success` +
            `&order=started_at.desc&limit=1&select=metadata`,
          { service: true },
        );
        const meta = prev[0]?.metadata ?? null;
        if (meta?.completed) break;

        if (pastFFThreshold(meta?.last_event_at)) {
          await backfillNav({ sb: sbFetch, trigger: "fast-forward" });
        } else {
          await fastForwardNav({ sb: sbFetch, trigger: "fast-forward" });
        }
      }
    } catch {
      // Each orchestrator PATCHes its own job row to status='failed' on
      // throw. The loop dies; user clicks BACKFILL again to resume from
      // the latest successful cursor (Bug 2 fix at jobs.js:186-189).
    }
  });
  redirect(
    `/admin/jobs${flashQs({ ok: "Backfill startet — se status nedenfor." })}`,
  );
}

// Cron toggle on /admin/jobs. Flips app_settings.cron_paused. The
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
      `/admin/jobs${flashQs({
        ok: next ? "Daglig henting pauset." : "Daglig henting aktivert.",
      })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(
      `/admin/jobs${flashQs({ error: `Toggle feilet: ${msg(err)}` })}`,
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
    `/admin/jobs${flashQs({ ok: "Snapshot-refresh startet — se status nedenfor." })}`,
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
