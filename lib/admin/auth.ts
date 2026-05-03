// Admin auth — HS256 verify of Supabase JWT, no SDK round-trip.
// Lifted verbatim (semantics-preserving TS port) from
// scripts/admin-server.js:23-47. The cookie is set by the login action and
// cleared by the logout action; middleware.ts is the front-door gate.

import "server-only";
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";

export const COOKIE_NAME = "sb_access_token";

// Defense in depth on top of GoTrue's DISABLE_SIGNUP=true (no random signups).
export const STAFF_ROLES = new Set([
  "super_admin",
  "admin",
  "employee",
  "read_only",
]);

export type StaffClaims = {
  sub?: string;
  email?: string;
  exp?: number;
  user_metadata?: {
    role?: string;
    full_name?: string;
  };
  [k: string]: unknown;
};

function b64urlToBuf(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export function verifySupabaseJwt(
  token: string | undefined | null,
  secret: string | undefined = process.env.SUPABASE_JWT_SECRET,
): StaffClaims | null {
  if (!token || !secret) return null;
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;
  const expected = createHmac("sha256", secret)
    .update(`${h}.${p}`)
    .digest("base64url");
  const a = Buffer.from(s);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(b64urlToBuf(p).toString("utf8")) as StaffClaims;
    if (typeof claims.exp === "number" && claims.exp * 1000 < Date.now()) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}

export function isStaff(claims: StaffClaims | null): boolean {
  return !!claims && STAFF_ROLES.has(claims.user_metadata?.role ?? "");
}

// Read claims from the Next request's cookie store. Returns null when there
// is no cookie, the JWT is invalid/expired, or the user is not staff.
export async function getStaffClaims(): Promise<StaffClaims | null> {
  const t = (await cookies()).get(COOKIE_NAME)?.value;
  const c = verifySupabaseJwt(t);
  return isStaff(c) ? c : null;
}
