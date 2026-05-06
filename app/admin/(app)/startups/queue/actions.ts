"use server";

import { redirect } from "next/navigation";
import { sbFetch } from "@/lib/admin/sb";
import { flashQs } from "@/lib/admin/flash";

function isRedirect(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "digest" in err);
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function retryFailedAction() {
  try {
    await sbFetch(`/brreg_url_queue?status=eq.failed`, {
      service: true,
      method: "PATCH",
      body: { status: "pending", attempts: 0, last_error: null },
      prefer: "return=minimal",
    });
    redirect(
      `/admin/startups/queue${flashQs({ ok: "Feilede rader satt tilbake til pending." })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(
      `/admin/startups/queue${flashQs({ error: `Tilbakestilling feilet: ${msg(err)}` })}`,
    );
  }
}

export async function discardFailedAction() {
  try {
    await sbFetch(`/brreg_url_queue?status=eq.failed`, {
      service: true,
      method: "DELETE",
      prefer: "return=minimal",
    });
    redirect(
      `/admin/startups/queue${flashQs({ ok: "Feilede rader forkastet." })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(
      `/admin/startups/queue${flashQs({ error: `Forkasting feilet: ${msg(err)}` })}`,
    );
  }
}
