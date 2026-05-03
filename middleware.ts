// /admin/:path* gate. Reads the sb_access_token cookie, verifies HS256
// locally (no SDK round-trip), redirects unauthed → /admin/login.
//
// Bypassed paths:
//   - /admin/login         (the login page itself)
//   - /admin/health        (cron-friendly liveness)
//   - /admin/api/jobs/*    (bearer-authed, the route handlers gate themselves)
//
// runtime: "nodejs" — node:crypto is not available on the Edge runtime.

import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAME, isStaff, verifySupabaseJwt } from "@/lib/admin/auth";

export const config = {
  matcher: ["/admin/:path*"],
  runtime: "nodejs",
};

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (
    pathname === "/admin/login" ||
    pathname === "/admin/health" ||
    pathname.startsWith("/admin/api/jobs/")
  ) {
    return NextResponse.next();
  }
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const claims = verifySupabaseJwt(token);
  if (!isStaff(claims)) {
    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}
