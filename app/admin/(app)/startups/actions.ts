"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import {
  bootstrapBrreg,
  fetchBrreg,
} from "@/lib/admin/legacy/brreg.js";
import { sbFetch } from "@/lib/admin/sb";
import { flashQs } from "@/lib/admin/flash";

// fetchBrreg is fast (one date filter, one or two pages of 1000 each →
// usually <30 s). Await it so the operator sees the count in the flash.
// bootstrapBrreg can run for many minutes (200 MB stream + per-row
// upserts) — defer with after(). The legacy snapshot + roles-burst
// actions were removed in PR 7: snapshots are covered by the global
// "Refresh snapshots" button on /admin/processes (calls all three
// domains' RPCs), and the roles-burst route runs on cron (12,42 each
// hour) — operators who really need to force a tick can curl the
// route directly.

function isRedirect(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "digest" in err);
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function ingestAction(formData: FormData) {
  const fromDate = (formData.get("from") as string) || null;
  const toDate = (formData.get("to") as string) || null;
  try {
    const result = await fetchBrreg({
      sb: sbFetch,
      trigger: "manual",
      fromDate,
      toDate,
    });
    redirect(
      `/admin/startups${flashQs({
        ok: `Hentet ${result.fetched} foretak (${result.upserted} upserted, ${result.enqueued} til rolle-kø)`,
      })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(
      `/admin/startups${flashQs({ error: `Henting feilet: ${msg(err)}` })}`,
    );
  }
}

// Brreg backfill — full-registry bulk-dump load. Renamed from
// bootstrapAction in PR 7 to match the cross-domain "Backfill" label
// (NAV uses the same word). The floor-date input was removed in the
// same PR; backfill now always loads the full Brreg registry. The
// underlying lib function bootstrapBrreg() still resolves null floor
// to "no filter" — see lib/admin/legacy/brreg.js + migration 0033.
export async function backfillAction() {
  after(async () => {
    try {
      await bootstrapBrreg({ sb: sbFetch, trigger: "manual", floorDate: null });
    } catch {
      // bootstrapBrreg writes its own failure PATCH to the jobs row.
    }
  });
  redirect(
    `/admin/startups${flashQs({
      ok: "Backfill startet — laster hele Brreg-registeret. Kan ta 10-30 min. Følg status nedenfor.",
    })}`,
  );
}

