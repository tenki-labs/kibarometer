"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  COOKIE_NAME,
  isStaff,
  verifySupabaseJwt,
} from "@/lib/admin/auth";
import { flashQs } from "@/lib/admin/flash";

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    redirect(`/admin/login${flashQs({ error: "E-post og passord kreves" })}`);
  }

  const SUPABASE_URL = process.env.SUPABASE_INTERNAL_URL!;
  const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  });
  if (!res.ok) {
    redirect(
      `/admin/login${flashQs({ error: "Ugyldig e-post eller passord" })}`,
    );
  }
  const data = (await res.json()) as { access_token?: string };
  const token = data.access_token;
  if (!token) {
    redirect(
      `/admin/login${flashQs({ error: "Ugyldig e-post eller passord" })}`,
    );
  }

  const claims = verifySupabaseJwt(token);
  if (!isStaff(claims)) {
    redirect(
      `/admin/login${flashQs({ error: "Kontoen har ikke tilgang til admin" })}`,
    );
  }

  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  redirect("/admin");
}

export async function logoutAction() {
  (await cookies()).delete(COOKIE_NAME);
  redirect("/admin/login");
}
