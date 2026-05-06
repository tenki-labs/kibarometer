"use server";

import { redirect } from "next/navigation";
import { sbFetch } from "@/lib/admin/sb";
import { flashQs } from "@/lib/admin/flash";

// Drift > Prosesser actions. Cross-cutting only — per-domain operations
// (NAV backfill / reprocess / etc) live in their respective domain hub
// actions modules now. PR 3 of admin restructure trimmed this file
// down to: cron-pause toggle (NAV cron, but the toggle is the canonical
// way to freeze ingestion globally) and the multi-domain snapshot
// refresh.

// Cross-domain "Refresh snapshots" button — calls the three RPCs
// (NAV, media, brreg) sequentially. Total wall time is <5 s in
// practice; safe to await without `after()`. Each RPC is idempotent
// (truncate + insert) so a partial failure mid-sequence leaves the
// previously-completed domains in a consistent state.
//
// We deliberately skip the `jobs` table for the orchestrator itself —
// each underlying RPC has its own job row in the per-domain refresh
// route handlers. Calling the RPCs directly here avoids triple-double-
// counting and keeps the manual + cron paths writing the same rows.
export async function refreshAllSnapshotsAction() {
  const results: string[] = [];
  try {
    await sbFetch(`/rpc/refresh_all_snapshots`, {
      service: true,
      method: "POST",
      body: {},
    });
    results.push("nav ok");
  } catch (err) {
    results.push(`nav fail: ${msg(err)}`);
  }
  try {
    await sbFetch(`/rpc/refresh_all_media_snapshots`, {
      service: true,
      method: "POST",
      body: {},
    });
    results.push("media ok");
  } catch (err) {
    results.push(`media fail: ${msg(err)}`);
  }
  try {
    await sbFetch(`/rpc/refresh_all_brreg_snapshots`, {
      service: true,
      method: "POST",
      body: {},
    });
    results.push("brreg ok");
  } catch (err) {
    results.push(`brreg fail: ${msg(err)}`);
  }

  const anyFailed = results.some((r) => r.includes("fail"));
  redirect(
    `/admin/processes${flashQs(
      anyFailed
        ? { error: `Refresh: ${results.join(" · ")}` }
        : { ok: `Refresh: ${results.join(" · ")}` },
    )}`,
  );
}

// NAV cron toggle. Flips app_settings.cron_paused. The kiba-fetcher
// crontab still ticks at its scheduled time; the route handler reads
// this flag and noops when paused. Lives on /admin/processes rather
// than /admin/job-market because it's the canonical "freeze ingestion"
// switch and operators expect to find it next to the global Refresh
// snapshots button (both being globals you reach for during incidents).
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
