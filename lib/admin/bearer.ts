// FETCHER_TOKEN bearer check for /admin/api/jobs/*. Returns null when the
// presented token matches; returns a 401 Response when it doesn't, so the
// caller pattern is `const denied = requireBearer(req); if (denied) return denied;`.
//
// timingSafeEqual prevents leaking the token via response-time side channels.
// Matches the semantics of scripts/admin-server.js:277-284.

import "server-only";
import { timingSafeEqual } from "node:crypto";

export function requireBearer(req: Request): Response | null {
  const expected = process.env.FETCHER_TOKEN;
  if (!expected) {
    return Response.json(
      { error: "FETCHER_TOKEN not configured" },
      { status: 500 },
    );
  }
  const auth = req.headers.get("authorization") || "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
