"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { sbFetch } from "@/lib/admin/sb";
import { flashQs } from "@/lib/admin/flash";

export async function updateAction(slug: string, formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const body_md = String(formData.get("body_md") ?? "");

  if (!title) {
    redirect(
      `/admin/content/${slug}${flashQs({ error: "Tittel kan ikke være tom" })}`,
    );
  }

  try {
    await sbFetch(
      `/site_content?slug=eq.${encodeURIComponent(slug)}`,
      {
        service: true,
        method: "PATCH",
        body: { title, body_md },
        prefer: "return=minimal",
      },
    );
    // Purge the live route's ISR cache so the next request renders fresh
    // copy instead of waiting up to 60s for the per-fetch revalidate
    // window (lib/supabase.ts sb() default).
    revalidatePath(`/${slug}`);
    redirect(`/admin/content/${slug}${flashQs({ ok: "Lagret" })}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(
      `/admin/content/${slug}${flashQs({
        error: err instanceof Error ? err.message : String(err),
      })}`,
    );
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
