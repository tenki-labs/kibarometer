"use server";

import { redirect } from "next/navigation";

import { flashQs } from "@/lib/admin/flash";
import { sbFetch } from "@/lib/admin/sb";

const LIST = "/admin/media/articles";

// Build the same PostgREST filter clause the list page uses, so bulk
// actions operate on exactly what the operator sees. Always carries
// deleted_at=is.null to avoid clobbering tombstoned rows.
function buildFilter(formData: FormData): { filter: string; preserveQs: string } {
  const sourceId = String(formData.get("source") ?? "").trim();
  const aiOnly = String(formData.get("ai") ?? "") === "1";
  const q = String(formData.get("q") ?? "").trim();

  const clauses: string[] = ["deleted_at=is.null"];
  if (sourceId) clauses.push(`source_id=eq.${encodeURIComponent(sourceId)}`);
  if (aiOnly) clauses.push("is_ai_related=is.true");
  if (q) {
    clauses.push(`headline=ilike.${encodeURIComponent(`*${q}*`)}`);
  }

  const preserve = new URLSearchParams();
  if (sourceId) preserve.set("source", sourceId);
  if (aiOnly) preserve.set("ai", "1");
  if (q) preserve.set("q", q);
  const preserveQs = preserve.toString() ? `?${preserve.toString()}` : "";

  return { filter: clauses.join("&"), preserveQs };
}

// Bulk: re-queue Tier 2 (and only Tier 2) on every matching row.
// Resets tier2_completed_at, llm_categories, llm_stance, llm_intensity
// and clears llm_retry_count so the next Tier 2 cron picks them up.
// Tier 1 results are kept (they're still valid — only the taxonomy or
// prompt changed).
export async function bulkReclassifyTier2Action(formData: FormData) {
  try {
    const { filter, preserveQs } = buildFilter(formData);
    // Constrain to rows that have tier2 set — there's nothing to reset
    // on rows that were never classified.
    const scoped = `${filter}&tier2_completed_at=not.is.null`;
    const updated = await sbFetch<{ id: string }[]>(`/media_articles?${scoped}`, {
      service: true,
      method: "PATCH",
      body: {
        tier2_completed_at: null,
        llm_categories: null,
        llm_stance: null,
        llm_intensity: null,
        llm_retry_count: 0,
      },
      prefer: "return=representation",
    });
    redirect(
      buildRedirect(preserveQs, {
        ok: `Re-køet ${updated.length} artikler for Tier 2-klassifisering`,
      }),
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`${LIST}${flashQs({ error: msg(err) })}`);
  }
}

// Bulk: full re-process. Resets both tier1 and tier2 + drops all LLM
// fields so the rows go back to the start of the cascade. Use after a
// keyword catalogue change or a Tier 1 prompt revision.
export async function bulkReclassifyAllAction(formData: FormData) {
  try {
    const { filter, preserveQs } = buildFilter(formData);
    const scoped = `${filter}&tier1_completed_at=not.is.null`;
    const updated = await sbFetch<{ id: string }[]>(`/media_articles?${scoped}`, {
      service: true,
      method: "PATCH",
      body: {
        tier1_completed_at: null,
        tier2_completed_at: null,
        llm_ai_phrases: null,
        llm_categories: null,
        llm_stance: null,
        llm_intensity: null,
        llm_retry_count: 0,
      },
      prefer: "return=representation",
    });
    redirect(
      buildRedirect(preserveQs, {
        ok: `Re-køet ${updated.length} artikler for full re-klassifisering (Tier 1 + Tier 2)`,
      }),
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`${LIST}${flashQs({ error: msg(err) })}`);
  }
}

// Merge filter-preserving QS with a flash QS without producing two `?` markers.
function buildRedirect(
  preserveQs: string,
  flash: { ok?: string; error?: string },
): string {
  const flashStr = flashQs(flash); // always starts with "?"
  if (!preserveQs) return `${LIST}${flashStr}`;
  return `${LIST}${preserveQs}&${flashStr.slice(1)}`;
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
