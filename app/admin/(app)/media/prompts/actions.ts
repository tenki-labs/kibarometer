"use server";

import { redirect } from "next/navigation";

import { flashQs } from "@/lib/admin/flash";
import { sbFetch } from "@/lib/admin/sb";

const LIST = "/admin/media/prompts";
const ROLES = ["tier1", "tier2"] as const;
type Role = (typeof ROLES)[number];

const MAX_BODY_BYTES = 50_000;

// New revision = new row. The table is append-only by design (migration 0018);
// `created_at` orders history, the partial unique index enforces one active
// per role. We never update body/examples in place.
export async function createRevisionAction(role: Role, formData: FormData) {
  const bodyText = String(formData.get("body") ?? "");
  const examplesRaw = String(formData.get("examples") ?? "").trim();

  try {
    if (!ROLES.includes(role)) throw new Error(`Ugyldig rolle: ${role}`);
    if (!bodyText.trim()) throw new Error("Brødtekst mangler");
    if (Buffer.byteLength(bodyText, "utf8") > MAX_BODY_BYTES) {
      throw new Error(
        `Brødtekst er for lang (maks ${MAX_BODY_BYTES.toLocaleString("nb-NO")} byte)`,
      );
    }
    if (role === "tier2" && !bodyText.includes("{{categories_block}}")) {
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
    if (!newId) throw new Error("PostgREST returnerte ingen id på ny revisjon");

    redirect(
      `${LIST}/${newId}${flashQs({
        ok: 'Lagret som ny revisjon. Trykk "Sett aktiv" for å bytte rolla.',
      })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`${LIST}${flashQs({ error: msg(err) })}`);
  }
}

// Two-step swap. Step 1 deactivates whichever row is currently active for
// this role *unless* it's already the target — so re-clicking on the active
// row is a no-op and we never violate the partial unique index. Brief window
// where no row is active is fine: lib/admin/llm-{discover,classify}.ts both
// short-circuit with {skipped: 'no_prompt'}/{skipped: 'no_taxonomy'} and the
// next cron tick picks up the new active row.
export async function setActiveAction(id: string, role: Role) {
  try {
    if (!ROLES.includes(role)) throw new Error(`Ugyldig rolle: ${role}`);
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

    redirect(
      `${LIST}${flashQs({
        ok: `Ny aktiv ${role === "tier1" ? "Tier 1" : "Tier 2"}-prompt`,
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
