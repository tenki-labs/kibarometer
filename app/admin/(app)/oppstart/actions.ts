"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import {
  bootstrapBrreg,
  enrichRolesBrreg,
  fetchBrreg,
  refreshBrregSnapshots,
} from "@/lib/admin/legacy/brreg.js";
import { sbFetch } from "@/lib/admin/sb";
import { flashQs } from "@/lib/admin/flash";

// fetchBrreg is fast (one date filter, one or two pages of 1000 each →
// usually <30 s). Await it so the operator sees the count in the flash.
// bootstrapBrreg can run for many minutes (200 MB stream + per-row
// upserts) — defer with after(). Roles burst is also deferred since it
// takes ~2-4 min. refreshBrregSnapshots awaits.

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
      `/admin/oppstart${flashQs({
        ok: `Hentet ${result.fetched} foretak (${result.upserted} upserted, ${result.enqueued} til rolle-kø)`,
      })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(
      `/admin/oppstart${flashQs({ error: `Henting feilet: ${msg(err)}` })}`,
    );
  }
}

export async function bootstrapAction(formData: FormData) {
  const floorDate = (formData.get("floor") as string) || null;
  after(async () => {
    try {
      await bootstrapBrreg({ sb: sbFetch, trigger: "manual", floorDate });
    } catch {
      // bootstrapBrreg writes its own failure PATCH to the jobs row.
    }
  });
  redirect(
    `/admin/oppstart${flashQs({
      ok: `Bootstrap startet${floorDate ? ` (fra ${floorDate})` : ""} — kan ta 10-30 min. Følg status nedenfor.`,
    })}`,
  );
}

export async function rolesBurstAction() {
  after(async () => {
    try {
      await enrichRolesBrreg({
        sb: sbFetch,
        trigger: "manual",
        k: 500,
        maxWallMs: 4 * 60_000,
      });
    } catch {
      // enrichRolesBrreg writes its own failure PATCH.
    }
  });
  redirect(
    `/admin/oppstart${flashQs({
      ok: "Rolle-kø burst startet (K=500, 4-min budsjett) — følg status nedenfor.",
    })}`,
  );
}

export async function refreshSnapshotsAction() {
  try {
    await refreshBrregSnapshots({ sb: sbFetch, trigger: "manual" });
    redirect(
      `/admin/oppstart${flashQs({ ok: "Snapshot-oppfriskning fullført." })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(
      `/admin/oppstart${flashQs({ error: `Oppfriskning feilet: ${msg(err)}` })}`,
    );
  }
}
