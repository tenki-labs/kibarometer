"use server";

import { redirect } from "next/navigation";

import { flashQs } from "@/lib/admin/flash";
import { sbFetch } from "@/lib/admin/sb";

const LIST = "/admin/startups/categories";

const RESERVED_SLUGS = new Set(["new"]);

function validSlug(s: string): boolean {
  if (s.length < 2 || s.length > 64) return false;
  if (RESERVED_SLUGS.has(s)) return false;
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s);
}

function nonEmpty(v: FormDataEntryValue | null): string | null {
  if (v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

type Shape = {
  slug: string;
  label_no: string;
  label_en: string | null;
  description: string | null;
  sort_order: number;
  is_active: boolean;
};

function parseForm(formData: FormData, allowSlug: boolean): Shape {
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const label_no = String(formData.get("label_no") ?? "").trim();
  const label_en = nonEmpty(formData.get("label_en"));
  const description = nonEmpty(formData.get("description"));
  const sortOrderRaw = String(formData.get("sort_order") ?? "100").trim();
  const sort_order = Number.parseInt(sortOrderRaw, 10);
  const is_active = formData.get("is_active") === "on";

  if (allowSlug && !validSlug(slug)) {
    throw new Error(
      "Slug må bestå av små bokstaver, tall og bindestrek (2–64 tegn)",
    );
  }
  if (!label_no) throw new Error("Norsk etikett mangler");
  if (label_no.length > 200) throw new Error("Norsk etikett er for lang (maks 200 tegn)");
  if (!Number.isFinite(sort_order) || sort_order < 0 || sort_order > 9999) {
    throw new Error("Sortering må være et tall mellom 0 og 9999");
  }

  return { slug, label_no, label_en, description, sort_order, is_active };
}

export async function createAction(formData: FormData) {
  try {
    const shape = parseForm(formData, true);
    try {
      await sbFetch(`/brreg_categories`, {
        service: true,
        method: "POST",
        body: shape,
        prefer: "return=minimal",
      });
    } catch (err) {
      if (err instanceof Error && /duplicate key|already exists|23505/.test(err.message)) {
        throw new Error(`Slug "${shape.slug}" finnes allerede`);
      }
      throw err;
    }
    redirect(`${LIST}${flashQs({ ok: `Opprettet kategori "${shape.label_no}"` })}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`${LIST}${flashQs({ error: msg(err) })}`);
  }
}

export async function updateAction(slug: string, formData: FormData) {
  try {
    const shape = parseForm(formData, false);
    const { slug: _slug, ...patchBody } = shape;
    void _slug;
    await sbFetch(`/brreg_categories?slug=eq.${encodeURIComponent(slug)}`, {
      service: true,
      method: "PATCH",
      body: patchBody,
      prefer: "return=minimal",
    });
    redirect(`${LIST}${flashQs({ ok: `Lagret "${shape.label_no}"` })}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`${LIST}${flashQs({ error: msg(err) })}`);
  }
}

export async function toggleActiveAction(slug: string, formData: FormData) {
  const next = String(formData.get("is_active") ?? "false") === "true";
  try {
    await sbFetch(`/brreg_categories?slug=eq.${encodeURIComponent(slug)}`, {
      service: true,
      method: "PATCH",
      body: { is_active: next },
      prefer: "return=minimal",
    });
    redirect(
      `${LIST}${flashQs({
        ok: next ? `Kategori "${slug}" aktivert` : `Kategori "${slug}" deaktivert`,
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
