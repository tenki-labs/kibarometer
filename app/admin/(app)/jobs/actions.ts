"use server";

import { redirect } from "next/navigation";
import {
  backfillNav,
  enrichNav,
  fetchNav,
  refreshSnapshots,
  reprocessNavPostings,
} from "@/lib/admin/legacy/jobs.js";
import { sbFetch } from "@/lib/admin/sb";
import { flashQs } from "@/lib/admin/flash";

// Each action mirrors the legacy POST handlers in
// scripts/admin-server.js:308-359 — call the orchestrator, redirect with a
// query-string flash. Identical messages so visual diff against legacy works.

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
  try {
    const result = await backfillNav({ sb: sbFetch, trigger: "manual" });
    const ok =
      result.status === "noop"
        ? "Backfill er allerede ferdig."
        : `Backfill-batch: ${result.pages} sider, ${result.items} stillinger${result.completed ? " — ferdig!" : ""}`;
    redirect(`/admin/jobs${flashQs({ ok })}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(
      `/admin/jobs${flashQs({ error: `Backfill feilet: ${msg(err)}` })}`,
    );
  }
}

export async function enrichAction() {
  try {
    const result = await enrichNav({ sb: sbFetch, trigger: "manual" });
    const ok =
      result.status === "noop"
        ? "Ingen ACTIVE stillinger å berike."
        : `Beriket ${result.enriched}, hoppet over ${result.inactive} (INACTIVE), feilet ${result.failed} av ${result.candidates} kandidater.`;
    redirect(`/admin/jobs${flashQs({ ok })}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(
      `/admin/jobs${flashQs({ error: `Berikelse feilet: ${msg(err)}` })}`,
    );
  }
}

export async function reprocessAction() {
  try {
    const result = await reprocessNavPostings({
      sb: sbFetch,
      trigger: "manual",
    });
    redirect(
      `/admin/keywords${flashQs({ ok: `Re-tagget ${result.updated} av ${result.scanned} stillinger.` })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(
      `/admin/keywords${flashQs({ error: `Re-tagging feilet: ${msg(err)}` })}`,
    );
  }
}

export async function refreshSnapshotsAction() {
  try {
    const result = await refreshSnapshots({ sb: sbFetch, trigger: "manual" });
    const hl = result.headline;
    const ok = hl
      ? `Snapshots oppdatert. AI-stillinger 7d: ${hl.ai_count_7d}, 30d: ${hl.ai_count_30d}.`
      : "Snapshots oppdatert.";
    redirect(`/admin/jobs${flashQs({ ok })}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(
      `/admin/jobs${flashQs({ error: `Snapshot-refresh feilet: ${msg(err)}` })}`,
    );
  }
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
