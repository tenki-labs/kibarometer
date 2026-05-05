"use server";

import { redirect } from "next/navigation";

import { flashQs } from "@/lib/admin/flash";
import { sbFetch } from "@/lib/admin/sb";

const LIST = "/admin/media";

// Trigger the snapshot orchestrator. Cheap (truncate+insert across 5 tables);
// run after a re-tag, a backfill burst, or anything else that materially
// changes the article rows the public dashboard reads.
export async function refreshSnapshotsAction() {
  try {
    await sbFetch("/rpc/refresh_all_media_snapshots", {
      service: true,
      method: "POST",
      body: {},
      prefer: "return=minimal",
    });
    redirect(`${LIST}${flashQs({ ok: "Snapshots regnet på nytt" })}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`${LIST}${flashQs({ error: msg(err) })}`);
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
