"use server";

import { redirect } from "next/navigation";
import {
  create,
  toggle,
  update,
} from "@/lib/admin/legacy/keywords.js";
import { sbFetch } from "@/lib/admin/sb";
import { flashQs } from "@/lib/admin/flash";

function bodyFromFormData(form: FormData): Record<string, string> {
  const body: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    if (typeof v === "string") body[k] = v;
  }
  return body;
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
