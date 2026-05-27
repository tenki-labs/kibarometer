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

// Hard delete a keyword row. Replaces the previous "Skjul" affordance,
// which set status='rejected' (a soft-delete that left the keyword in
// the catalogue forever, accumulating as cruft).
//
// What gets cleaned up:
//   - The keywords row itself (PostgREST DELETE).
//   - Stale references in nav_postings.matched_keywords (text[]) clear
//     at the next reprocess run when applyTags() rebuilds the array.
//   - Same for media_articles.matched_keywords (jsonb) at the next
//     media-fetch-classify tick on those rows.
//   - keyword_candidates rows that referenced this term are NOT
//     touched — they're audit history. If the same phrase resurfaces
//     in the next refresh_keyword_candidates() run, a new pending row
//     gets inserted with the existing rejected/promoted history alongside.
//
// No cascade FK in schema, so this is safe to run synchronously.
export async function deleteAction(id: string) {
  try {
    if (!id) throw new Error("Mangler id");
    await sbFetch(`/keywords?id=eq.${encodeURIComponent(id)}`, {
      service: true,
      method: "DELETE",
      prefer: "return=minimal",
    });
    redirect(`/admin/keywords${flashQs({ ok: "Slettet" })}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`/admin/keywords${flashQs({ error: `Sletting feilet: ${msg(err)}` })}`);
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
