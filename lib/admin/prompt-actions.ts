// Server-action implementations for the prompts UI, parameterized by
// the role allowlist + redirect base. Each domain's actions module
// (/admin/job-market/prompts/actions.ts and /admin/media/prompts/
// actions.ts) imports these and binds its own ROLES + LIST. Keeps the
// validation, JSON parsing, and two-step active-row swap in one place
// so the two domains can never drift in subtle ways.
//
// Note: this module is NOT marked "use server" — that's the importing
// actions.ts files' job. Functions exported here are plain helpers
// intended to be re-exported (with bound role list) as server actions.

import { redirect } from "next/navigation";

import { flashQs } from "@/lib/admin/flash";
import { sbFetch } from "@/lib/admin/sb";

const MAX_BODY_BYTES = 50_000;

// Tier 2 prompts that classify into taxonomies need this placeholder so
// lib/admin/llm-{classify,media-tier2,brreg-tier2}.ts can substitute the
// active taxonomy at runtime. NAV's `tier2`, media's `media_tier2`, and
// brreg's `brreg_tier2` all share this contract.
function requiresCategoriesBlock(role: string): boolean {
  return (
    role === "tier2" ||
    role === "media_tier2" ||
    role === "brreg_tier2" ||
    role === "offentlig_storting_tier2" ||
    role === "offentlig_doffin_tier2"
  );
}

export type PromptActionsConfig = {
  // Allowed roles for this domain — e.g. ["tier1", "tier2"] for NAV
  // or ["media_tier1", "media_tier2"] for media. Validation rejects
  // anything outside this set so a bad form post can't write the
  // wrong domain's row.
  roles: readonly string[];
  // /admin/job-market/prompts or /admin/media/prompts. No trailing slash.
  list: string;
  // Friendly labels for flash messages, e.g. { tier1: "Tier 1", tier2: "Tier 2" }.
  // Falls back to the raw role if missing.
  roleLabels?: Record<string, string>;
};

export function makePromptActions(cfg: PromptActionsConfig) {
  const { roles, list, roleLabels = {} } = cfg;

  async function createRevisionAction(role: string, formData: FormData) {
    const bodyText = String(formData.get("body") ?? "");
    const examplesRaw = String(formData.get("examples") ?? "").trim();

    try {
      if (!roles.includes(role)) throw new Error(`Ugyldig rolle: ${role}`);
      if (!bodyText.trim()) throw new Error("Brødtekst mangler");
      if (Buffer.byteLength(bodyText, "utf8") > MAX_BODY_BYTES) {
        throw new Error(
          `Brødtekst er for lang (maks ${MAX_BODY_BYTES.toLocaleString("nb-NO")} byte)`,
        );
      }
      if (
        requiresCategoriesBlock(role) &&
        !bodyText.includes("{{categories_block}}")
      ) {
        throw new Error(
          'Tier 2-prompten må inneholde plassholderen "{{categories_block}}" — den erstattes ved kjøretid med aktiv taksonomi.',
        );
      }

      let examples: unknown = null;
      if (examplesRaw) {
        try {
          examples = JSON.parse(examplesRaw);
        } catch (err) {
          throw new Error(
            `Examples JSON er ugyldig: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      const inserted = await sbFetch<{ id: string }[]>(`/llm_prompts`, {
        service: true,
        method: "POST",
        body: { role, body: bodyText, examples, active: false },
        prefer: "return=representation",
      });
      const newId = inserted[0]?.id;
      if (!newId)
        throw new Error("PostgREST returnerte ingen id på ny revisjon");

      redirect(
        `${list}/${newId}${flashQs({
          ok: 'Lagret som ny revisjon. Trykk "Sett aktiv" for å bytte rolla.',
        })}`,
      );
    } catch (err) {
      if (isRedirect(err)) throw err;
      redirect(`${list}${flashQs({ error: msg(err) })}`);
    }
  }

  // Two-step swap. Step 1 deactivates whichever row is currently active
  // for this role unless it's already the target — re-clicking the
  // active row is a no-op so we never violate the partial unique index.
  // Brief window where no row is active is fine: the LLM pipelines all
  // short-circuit when no active prompt exists and the next cron tick
  // picks up the new row.
  async function setActiveAction(id: string, role: string) {
    try {
      if (!roles.includes(role)) throw new Error(`Ugyldig rolle: ${role}`);
      if (!id) throw new Error("Mangler id");

      await sbFetch(
        `/llm_prompts?role=eq.${role}&active=is.true&id=neq.${encodeURIComponent(id)}`,
        {
          service: true,
          method: "PATCH",
          body: { active: false },
          prefer: "return=minimal",
        },
      );
      await sbFetch(`/llm_prompts?id=eq.${encodeURIComponent(id)}`, {
        service: true,
        method: "PATCH",
        body: { active: true },
        prefer: "return=minimal",
      });

      const label = roleLabels[role] ?? role;
      redirect(
        `${list}${flashQs({
          ok: `Ny aktiv ${label}-prompt`,
        })}`,
      );
    } catch (err) {
      if (isRedirect(err)) throw err;
      redirect(`${list}${flashQs({ error: msg(err) })}`);
    }
  }

  return { createRevisionAction, setActiveAction };
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
