"use server";

import { redirect } from "next/navigation";

import { flashQs } from "@/lib/admin/flash";
import { sbFetch } from "@/lib/admin/sb";
import { getStaffClaims } from "@/lib/admin/auth";

const LIST_ORACLE = "/admin/offentlig/queue?tab=oracle";

// Oracle accept — log the operator's "LLM was right" decision to
// tier2_corrections. No state change on the sak itself.
export async function oracleAcceptAction(formData: FormData) {
  const sakIdRaw = formData.get("sak_id");
  const slugRaw = formData.get("proposed_slug");

  const sakId =
    typeof sakIdRaw === "string" && sakIdRaw.trim().length > 0
      ? sakIdRaw.trim()
      : null;
  if (!sakId) {
    redirect(`${LIST_ORACLE}${flashQs({ error: "Mangler sak_id." })}`);
  }
  const slug = typeof slugRaw === "string" ? slugRaw.trim() : null;

  try {
    const staff = await getStaffClaims();
    await sbFetch("/tier2_corrections", {
      service: true,
      method: "POST",
      body: {
        source_table: "storting_saker",
        source_id: sakId,
        proposed_slug: slug || null,
        accepted_slug: slug || null,
        action: "accept",
        corrected_by: staff?.sub ?? null,
      },
      prefer: "return=minimal",
    });
    redirect(`${LIST_ORACLE}${flashQs({ ok: `Bekreftet sak ${sakId}.` })}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`${LIST_ORACLE}${flashQs({ error: msg(err) })}`);
  }
}

// Mark-not-AI — log + clear llm_categories on the sak so it drops out of
// snapshot aggregation (the snapshot SQL filters on
// `tier2_completed_at IS NOT NULL AND elem->>'slug' IS NOT NULL` —
// clearing the categories array removes the row from per-category buckets
// AND from the synthetic '__uncategorized' bucket).
//
// Does NOT flip is_ai_relevant (that's keyword-driven). Operator should
// surface the keyword to /admin/keywords if the catalog itself needs to
// change.
export async function oracleMarkNotAiAction(formData: FormData) {
  const sakIdRaw = formData.get("sak_id");
  const notesRaw = formData.get("notes");

  const sakId =
    typeof sakIdRaw === "string" && sakIdRaw.trim().length > 0
      ? sakIdRaw.trim()
      : null;
  if (!sakId) {
    redirect(`${LIST_ORACLE}${flashQs({ error: "Mangler sak_id." })}`);
  }
  const notes = typeof notesRaw === "string" ? notesRaw.slice(0, 400) : null;

  try {
    const staff = await getStaffClaims();

    // Log the correction (mark_not_ai → accepted_slug is intentionally null).
    await sbFetch("/tier2_corrections", {
      service: true,
      method: "POST",
      body: {
        source_table: "storting_saker",
        source_id: sakId,
        action: "mark_not_ai",
        notes,
        corrected_by: staff?.sub ?? null,
      },
      prefer: "return=minimal",
    });

    // Clear llm_categories so the sak drops out of snapshot aggregation on
    // the next refresh tick. We preserve tier2_completed_at so the row
    // doesn't get re-queued for Tier 2.
    await sbFetch(`/storting_saker?sak_id=eq.${sakId}`, {
      service: true,
      method: "PATCH",
      body: {
        llm_categories: {
          categories: [],
          rationale: "operator marked not AI",
          operator_override: true,
        },
      },
      prefer: "return=minimal",
    });

    redirect(
      `${LIST_ORACLE}${flashQs({ ok: `Sak ${sakId} markert som ikke-AI.` })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`${LIST_ORACLE}${flashQs({ error: msg(err) })}`);
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
