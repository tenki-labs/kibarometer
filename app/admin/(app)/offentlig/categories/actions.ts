"use server";

import { redirect } from "next/navigation";

import { flashQs } from "@/lib/admin/flash";
import { sbFetch } from "@/lib/admin/sb";

const LIST = "/admin/offentlig/categories?tab=storting";

// Toggle a storting_categories row's is_active flag. Same shape as
// media/categories/actions.ts: PATCH the row by slug PK, redirect with
// a flash. Tier 2 reads `is_active=true` at every cron tick so the
// change propagates on the next call without a redeploy.
export async function toggleStortingActiveAction(slug: string, formData: FormData) {
  const next = formData.get("is_active") === "true";
  if (!slug) {
    redirect(`${LIST}${flashQs({ error: "Mangler slug." })}`);
  }
  try {
    await sbFetch(`/storting_categories?slug=eq.${encodeURIComponent(slug)}`, {
      service: true,
      method: "PATCH",
      body: { is_active: next },
      prefer: "return=minimal",
    });
    redirect(
      `${LIST}${flashQs({ ok: `${slug} satt til ${next ? "aktiv" : "inaktiv"}.` })}`,
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
