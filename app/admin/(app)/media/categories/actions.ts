"use server";

import { redirect } from "next/navigation";

import { flashQs } from "@/lib/admin/flash";
import { sbFetch } from "@/lib/admin/sb";

const LIST = "/admin/media/categories";

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
  parent_slug: string | null;
  description: string | null;
  is_active: boolean;
};

function parseForm(formData: FormData, allowSlug: boolean): Shape {
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const label_no = String(formData.get("label_no") ?? "").trim();
  const label_en = nonEmpty(formData.get("label_en"));
  const parent_slug = nonEmpty(formData.get("parent_slug"));
  const description = nonEmpty(formData.get("description"));
  const is_active = formData.get("is_active") === "on";

  if (allowSlug && !validSlug(slug)) {
    throw new Error(
      "Slug må bestå av små bokstaver, tall og bindestrek (2–64 tegn)",
    );
  }
  if (!label_no) throw new Error("Norsk etikett mangler");
  if (label_no.length > 200) throw new Error("Norsk etikett er for lang (maks 200 tegn)");

  return { slug, label_no, label_en, parent_slug, description, is_active };
}

export async function createAction(formData: FormData) {
  try {
    const shape = parseForm(formData, true);
    try {
      await sbFetch(`/media_categories`, {
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
    await sbFetch(`/media_categories?slug=eq.${encodeURIComponent(slug)}`, {
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
    await sbFetch(`/media_categories?slug=eq.${encodeURIComponent(slug)}`, {
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
