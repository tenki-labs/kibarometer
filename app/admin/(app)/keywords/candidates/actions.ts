"use server";

import { redirect } from "next/navigation";

import { flashQs } from "@/lib/admin/flash";
import { sbFetch } from "@/lib/admin/sb";

const LANGUAGES = ["any", "no", "en"] as const;
const CATEGORIES = ["tool", "role", "concept"] as const;
const MATCH_TYPES = ["word", "substring"] as const;

type Language = (typeof LANGUAGES)[number];
type Category = (typeof CATEGORIES)[number];
type MatchType = (typeof MATCH_TYPES)[number];

// Single dispatch action so the row can render one form with multiple submit
// buttons (intent=trial|canonical|merge|reject). Validation per intent below.
export async function actAction(termNorm: string, formData: FormData) {
  const intent = String(formData.get("intent") ?? "");
  const reviewer = String(formData.get("reviewed_by") ?? "admin");
  try {
    if (intent === "trial" || intent === "canonical") {
      await promote(termNorm, intent, formData, reviewer);
      redirect(
        `/admin/keywords/candidates${flashQs({
          ok:
            intent === "trial"
              ? `Godkjent som trial: "${termNorm}"`
              : `Godkjent som kanonisk: "${termNorm}"`,
        })}`,
      );
    }
    if (intent === "merge") {
      const targetId = String(formData.get("merge_target_id") ?? "");
      if (!targetId) throw new Error("Velg et nøkkelord å slå sammen med");
      const target = await loadKeywordById(targetId);
      if (!target) throw new Error("Fant ikke målnøkkelord");
      await markCandidate(termNorm, "merged", reviewer, target.term);
      const updated = await applyKeywordToPostings(termNorm, target.term);
      redirect(
        `/admin/keywords/candidates${flashQs({
          ok:
            `Slått sammen "${termNorm}" → "${target.term}" ` +
            `(${updated} stilling${updated === 1 ? "" : "er"} oppdatert)`,
        })}`,
      );
    }
    if (intent === "reject") {
      await markCandidate(termNorm, "rejected", reviewer, null);
      redirect(
        `/admin/keywords/candidates${flashQs({
          ok: `Avvist: "${termNorm}"`,
        })}`,
      );
    }
    throw new Error(`Ukjent handling: ${intent}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`/admin/keywords/candidates${flashQs({ error: msg(err) })}`);
  }
}

export async function graduateAction(keywordId: string) {
  try {
    await sbFetch(`/keywords?id=eq.${encodeURIComponent(keywordId)}`, {
      service: true,
      method: "PATCH",
      body: { status: "canonical" },
      prefer: "return=minimal",
    });
    redirect(
      `/admin/keywords/candidates${flashQs({
        ok: "Graduert til kanonisk",
      })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`/admin/keywords/candidates${flashQs({ error: msg(err) })}`);
  }
}

export async function demoteAction(keywordId: string) {
  try {
    await sbFetch(`/keywords?id=eq.${encodeURIComponent(keywordId)}`, {
      service: true,
      method: "PATCH",
      body: { status: "rejected" },
      prefer: "return=minimal",
    });
    redirect(
      `/admin/keywords/candidates${flashQs({
        ok: "Demotert til avvist",
      })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`/admin/keywords/candidates${flashQs({ error: msg(err) })}`);
  }
}

async function promote(
  termNorm: string,
  status: "trial" | "canonical",
  formData: FormData,
  reviewer: string,
) {
  const term = String(formData.get("term") ?? termNorm).trim();
  if (!term) throw new Error("Term mangler");
  if (term.length > 200) throw new Error("Term er for lang (maks 200 tegn)");

  const language = pickEnum<Language>(formData.get("language"), LANGUAGES);
  const category = pickEnum<Category>(formData.get("category"), CATEGORIES);
  const matchType = pickEnum<MatchType>(
    formData.get("match_type"),
    MATCH_TYPES,
  );

  // Insert keyword. Unique (term_norm, language) — surface a friendly error
  // on duplicate, mirroring lib/admin/legacy/keywords.js::create().
  try {
    await sbFetch(`/keywords`, {
      service: true,
      method: "POST",
      body: {
        term,
        language,
        category,
        match_type: matchType,
        status,
        notes: `Promoted from candidate "${termNorm}"`,
      },
      prefer: "return=minimal",
    });
  } catch (err) {
    if (
      err instanceof Error &&
      /duplicate key|already exists|23505/.test(err.message)
    ) {
      throw new Error(`"${term}" finnes allerede for ${language}`);
    }
    throw err;
  }

  await markCandidate(termNorm, status, reviewer, null);

  // Backfill matched_keywords for postings that already saw this phrase via
  // Tier 1. For trial this seeds observability data immediately; for canonical
  // it lights up is_ai retroactively (verification step 8 in the plan).
  await applyKeywordToPostings(termNorm, term);
}

async function markCandidate(
  termNorm: string,
  status: "trial" | "canonical" | "rejected" | "merged",
  reviewer: string,
  mergedInto: string | null,
) {
  const body: Record<string, unknown> = {
    status,
    reviewed_at: new Date().toISOString(),
    reviewed_by: reviewer || "admin",
  };
  if (status === "merged") body.merged_into_term = mergedInto;
  await sbFetch(
    `/keyword_candidates?term_norm=eq.${encodeURIComponent(termNorm)}`,
    {
      service: true,
      method: "PATCH",
      body,
      prefer: "return=minimal",
    },
  );
}

async function applyKeywordToPostings(
  matchTerm: string,
  keywordTerm: string,
): Promise<number> {
  // PostgREST RPC. Function lives in 0019_promote_keyword_candidate.sql.
  // Returns the count of nav_postings rows updated (int).
  const result = await sbFetch<number>(`/rpc/apply_keyword_to_postings`, {
    service: true,
    method: "POST",
    body: { p_match_term: matchTerm, p_keyword_term: keywordTerm },
  });
  return typeof result === "number" ? result : 0;
}

async function loadKeywordById(
  id: string,
): Promise<{ id: string; term: string } | null> {
  const rows = await sbFetch<{ id: string; term: string }[]>(
    `/keywords?id=eq.${encodeURIComponent(id)}&select=id,term&limit=1`,
    { service: true },
  );
  return rows[0] ?? null;
}

function pickEnum<T extends string>(
  raw: FormDataEntryValue | null,
  allowed: readonly T[],
): T {
  const v = String(raw ?? "");
  if ((allowed as readonly string[]).includes(v)) return v as T;
  throw new Error(`Ugyldig verdi: ${v}`);
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
