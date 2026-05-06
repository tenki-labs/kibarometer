"use server";

import { redirect } from "next/navigation";

import { flashQs } from "@/lib/admin/flash";
import { sbFetch } from "@/lib/admin/sb";

const LIST = "/admin/media/queue";

// Reset a failed row back to pending so the next fetch-classify tick
// retries it. Resets attempts to 0 so the operator gets a clean attempt.
export async function retryQueueAction(id: string) {
  try {
    await sbFetch(`/media_url_queue?id=eq.${encodeURIComponent(id)}`, {
      service: true,
      method: "PATCH",
      body: { status: "pending", attempts: 0, last_error: null },
      prefer: "return=minimal",
    });
    redirect(`${LIST}${flashQs({ ok: "Re-køet" })}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`${LIST}${flashQs({ error: msg(err) })}`);
  }
}

// Bulk-reset every failed row older than 7 days. Operator escape hatch
// for a queue full of dead URLs (404s, paywalls, retired domains).
export async function discardOldFailedAction() {
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const deleted = await sbFetch<{ id: string }[]>(
      `/media_url_queue?status=eq.failed&discovered_at=lt.${encodeURIComponent(cutoff)}`,
      {
        service: true,
        method: "DELETE",
        prefer: "return=representation",
      },
    );
    redirect(
      `${LIST}${flashQs({
        ok: `Slettet ${deleted.length} feilede rader eldre enn 7 dager`,
      })}`,
    );
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
