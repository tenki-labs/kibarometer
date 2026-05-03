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
import { sbFetch } from "@/lib/admin/sb";
import { flashQs } from "@/lib/admin/flash";

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
