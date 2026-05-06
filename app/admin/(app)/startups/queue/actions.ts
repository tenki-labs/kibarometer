"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";

import { sbFetch } from "@/lib/admin/sb";
import { flashQs } from "@/lib/admin/flash";
import { enrichRolesBrreg } from "@/lib/admin/legacy/brreg.js";

function isRedirect(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "digest" in err);
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Burst-drain the role-fetch queue. K=500 / 4-min wall budget — same
// orchestrator as /admin/api/jobs/brreg-roles-burst, surfaced as a UI
// button so operators can flush a backlog without curling the route.
// Cron drains K=50 per tick at :12 + :42 each hour; this is the
// catch-up button.
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
      // enrichRolesBrreg writes its own failure PATCH to the jobs row.
    }
  });
  redirect(
    `/admin/startups/queue${flashQs({
      ok: "Rolle-burst startet — følg progresjon på /admin/processes.",
    })}`,
  );
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
