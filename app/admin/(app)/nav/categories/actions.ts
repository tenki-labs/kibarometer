"use server";

import { redirect } from "next/navigation";

import { flashQs } from "@/lib/admin/flash";
import { runReprocess, type ReprocessScope } from "@/lib/admin/llm-reprocess";
import { sbFetch } from "@/lib/admin/sb";

const VALID_SCOPES = new Set<ReprocessScope>([
  "all_ai",
  "category",
  "since_date",
]);

const LIST = "/admin/nav/categories";

export async function createAction(formData: FormData) {
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const title = String(formData.get("title") ?? "").trim();
  const definition_md = String(formData.get("definition_md") ?? "");
  const sortRaw = String(formData.get("sort_order") ?? "0").trim();

  try {
    if (!validSlug(slug)) {
      throw new Error(
        "Slug må bestå av små bokstaver, tall og bindestrek (2–64 tegn, ingen ledende/etterstilte bindestreker)",
      );
    }
    if (!title) throw new Error("Tittel mangler");
    if (title.length > 200) throw new Error("Tittel er for lang (maks 200 tegn)");
    const sort_order = parseSortOrder(sortRaw);

    try {
      await sbFetch(`/taxonomy_categories`, {
        service: true,
        method: "POST",
        body: { slug, title, definition_md, sort_order },
        prefer: "return=minimal",
      });
    } catch (err) {
      if (
        err instanceof Error &&
        /duplicate key|already exists|23505/.test(err.message)
      ) {
        throw new Error(`Slug "${slug}" finnes allerede`);
      }
      throw err;
    }

    await bumpVersion(`created ${slug}`);
    redirect(`${LIST}/${slug}${flashQs({ ok: `Opprettet kategori "${title}"` })}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`${LIST}/new${flashQs({ error: msg(err) })}`);
  }
}

export async function updateAction(slug: string, formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const definition_md = String(formData.get("definition_md") ?? "");
  const sortRaw = String(formData.get("sort_order") ?? "0").trim();

  try {
    if (!title) throw new Error("Tittel mangler");
    if (title.length > 200) throw new Error("Tittel er for lang (maks 200 tegn)");
    const sort_order = parseSortOrder(sortRaw);

    await sbFetch(
      `/taxonomy_categories?slug=eq.${encodeURIComponent(slug)}`,
      {
        service: true,
        method: "PATCH",
        body: { title, definition_md, sort_order },
        prefer: "return=minimal",
      },
    );
    await bumpVersion(`edited ${slug}`);
    redirect(`${LIST}/${slug}${flashQs({ ok: "Lagret" })}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`${LIST}/${slug}${flashQs({ error: msg(err) })}`);
  }
}

export async function retireAction(slug: string) {
  try {
    await sbFetch(
      `/taxonomy_categories?slug=eq.${encodeURIComponent(slug)}&retired_at=is.null`,
      {
        service: true,
        method: "PATCH",
        body: { retired_at: new Date().toISOString() },
        prefer: "return=minimal",
      },
    );
    await bumpVersion(`retired ${slug}`);
    redirect(
      `${LIST}${flashQs({
        ok: `Kategori "${slug}" pensjonert (gamle klassifiseringer beholdes som audit)`,
      })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`${LIST}/${slug}${flashQs({ error: msg(err) })}`);
  }
}

// Per-row "Re-klassifiser" button on the list page. Always scope=category for
// the row's slug. Resets tier2_completed_at on matching nav_postings; the
// regular Tier 2 cron picks them up.
export async function reprocessCategoryAction(slug: string) {
  try {
    const result = await runReprocess({
      sb: sbFetch,
      trigger: "manual",
      scope: "category",
      category_slug: slug,
    });
    if (result.status === "error") throw new Error(result.error ?? "Ukjent feil");
    if (result.status === "noop") {
      redirect(
        `${LIST}${flashQs({
          ok: `Ingen stillinger med kategori "${slug}" å re-klassifisere`,
        })}`,
      );
    }
    redirect(
      `${LIST}${flashQs({
        ok:
          `Re-køet ${result.reset} stilling${result.reset === 1 ? "" : "er"} for kategori "${slug}" ` +
          `(~${estimateMinutes(result.reset)} min på Mac-en)`,
      })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`${LIST}${flashQs({ error: msg(err) })}`);
  }
}

// Global re-classify form on the list page. Two intents:
//   * preview — runReprocess(dry_run=true), flash count + estimate
//   * run     — runReprocess(dry_run=false), flash actual reset count
export async function reprocessAction(formData: FormData) {
  const intent = String(formData.get("intent") ?? "preview");
  const scopeRaw = String(formData.get("scope") ?? "");
  try {
    if (!VALID_SCOPES.has(scopeRaw as ReprocessScope)) {
      throw new Error(`Ugyldig omfang: ${scopeRaw}`);
    }
    const scope = scopeRaw as ReprocessScope;
    const category_slug = String(formData.get("category_slug") ?? "") || undefined;
    const since_date = String(formData.get("since_date") ?? "") || undefined;

    if (scope === "category" && !category_slug) {
      throw new Error("Velg en kategori");
    }
    if (scope === "since_date" && !since_date) {
      throw new Error("Velg en dato");
    }

    const dry_run = intent !== "run";
    const result = await runReprocess({
      sb: sbFetch,
      trigger: "manual",
      scope,
      category_slug,
      since_date,
      dry_run,
    });
    if (result.status === "error") throw new Error(result.error ?? "Ukjent feil");

    const scopeLabel = describeScope(scope, category_slug, since_date);
    if (dry_run) {
      redirect(
        `${LIST}${flashQs({
          ok:
            `Forhåndsvisning · ${result.matched} stilling${result.matched === 1 ? "" : "er"} ` +
            `matcher ${scopeLabel} (~${estimateMinutes(result.matched)} min på Mac-en). ` +
            `Trykk Kjør for å re-klassifisere.`,
        })}`,
      );
    }
    if (result.status === "noop") {
      redirect(
        `${LIST}${flashQs({
          ok: `Ingen stillinger matchet ${scopeLabel}`,
        })}`,
      );
    }
    redirect(
      `${LIST}${flashQs({
        ok:
          `Re-køet ${result.reset} stilling${result.reset === 1 ? "" : "er"} for ${scopeLabel} ` +
          `(~${estimateMinutes(result.reset)} min på Mac-en)`,
      })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`${LIST}${flashQs({ error: msg(err) })}`);
  }
}

async function bumpVersion(notes: string) {
  await sbFetch(`/taxonomy_versions`, {
    service: true,
    method: "POST",
    body: { notes },
    prefer: "return=minimal",
  });
}

// "new" is reserved because /admin/nav/categories/new is the create-page route;
// a real slug "new" would be shadowed by the static segment.
const RESERVED_SLUGS = new Set(["new"]);

function validSlug(s: string): boolean {
  if (s.length < 2 || s.length > 64) return false;
  if (RESERVED_SLUGS.has(s)) return false;
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s);
}

function parseSortOrder(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error("Sortering må være et heltall");
  }
  if (n < -10000 || n > 10000) {
    throw new Error("Sortering må være mellom -10000 og 10000");
  }
  return n;
}

// Tier 2 LLM call cost from the plan: ~12 s per posting. Round up so the
// estimate doesn't undersell.
function estimateMinutes(count: number): number {
  if (count <= 0) return 0;
  return Math.max(1, Math.ceil((count * 12) / 60));
}

function describeScope(
  scope: ReprocessScope,
  category_slug: string | undefined,
  since_date: string | undefined,
): string {
  if (scope === "all_ai") return "alle AI-stillinger";
  if (scope === "category") return `kategori "${category_slug}"`;
  return `stillinger postet fra ${since_date}`;
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
