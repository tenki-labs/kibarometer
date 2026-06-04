"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import {
  create,
  toggle,
  update,
} from "@/lib/admin/legacy/keywords.js";
import { reprocessNavPostings } from "@/lib/admin/legacy/jobs.js";
import { reprocessBrregCompanies } from "@/lib/admin/legacy/brreg-reprocess.js";
import { reprocessMediaArticles } from "@/lib/admin/legacy/media-reprocess.js";
import { sbFetch } from "@/lib/admin/sb";
import { flashQs } from "@/lib/admin/flash";

function bodyFromFormData(form: FormData): Record<string, string> {
  const body: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    if (typeof v === "string") body[k] = v;
  }
  return body;
}

// Fans out a keyword retag across all three keyword-driven pillars (NAV,
// BRREG, media). The catalog at /admin/keywords is shared, so editing a
// keyword should refresh all three. Each orchestrator owns its own jobs
// row + heartbeats + terminal PATCH; we use Promise.allSettled so one
// orchestrator failing doesn't poison the other two. The per-orchestrator
// .catch() blocks swallow rejection so allSettled sees fulfilled
// promises — each orchestrator already wrote its own failure PATCH.
export async function reprocessAllAction() {
  after(async () => {
    await Promise.allSettled([
      reprocessNavPostings({ sb: sbFetch, trigger: "manual" }).catch(() => {}),
      reprocessBrregCompanies({ sb: sbFetch, trigger: "manual" }).catch(() => {}),
      reprocessMediaArticles({ sb: sbFetch, trigger: "manual" }).catch(() => {}),
    ]);
  });
  redirect(
    `/admin/keywords${flashQs({ ok: "Re-tagging av alle pilarer startet — se /admin/processes for status." })}`,
  );
}

export async function createAction(formData: FormData) {
  const body = bodyFromFormData(formData);
  try {
    const row = await create({ sb: sbFetch, body });
    redirect(`/admin/keywords${flashQs({ ok: `La til "${row.term}"` })}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`/admin/keywords${flashQs({ error: msg(err) })}`);
  }
}

export async function updateAction(id: string, formData: FormData) {
  const body = bodyFromFormData(formData);
  try {
    await update({ sb: sbFetch, id, body });
    redirect(`/admin/keywords${flashQs({ ok: "Lagret" })}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`/admin/keywords/${id}${flashQs({ error: msg(err) })}`);
  }
}

export async function toggleAction(id: string) {
  try {
    const row = await toggle({ sb: sbFetch, id });
    redirect(
      `/admin/keywords${flashQs({ ok: row.status === "canonical" ? "Aktivert" : "Deaktivert" })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`/admin/keywords${flashQs({ error: msg(err) })}`);
  }
}

// NOTE: there is intentionally NO hard-delete action for keywords. Removing a
// keyword is a soft-delete — `toggleAction` sets status='rejected' (see
// lib/admin/legacy/keywords.js: `toggle`). A hard `DELETE` used to live here,
// but the keyword seeds in re-runnable migrations (0006_keywords.sql,
// 0030_brreg.sql) use `insert ... on conflict (term_norm, language) do
// nothing`: once the row is hard-deleted there is no conflict, so the next
// deploy RE-INSERTS the term as a fresh `canonical` keyword — silently
// resurrecting a term the operator removed (this is the "VIBE MAT AS"
// food-company false-positive that re-appeared after every deploy). A
// `rejected` tombstone survives `on conflict do nothing`, so a soft-delete
// stays removed across deploys. Do not reintroduce a DELETE affordance here.

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
