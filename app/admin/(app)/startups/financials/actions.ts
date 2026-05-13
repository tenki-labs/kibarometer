"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";

import { drainFinancials } from "@/lib/admin/legacy/brreg-financials.js";
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
