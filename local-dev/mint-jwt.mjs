#!/usr/bin/env node
// Mint a Supabase HS256 JWT for the given role. Pure node:crypto, no pnpm/tsx needed.
// Used by setup.sh to derive ANON_KEY and SERVICE_ROLE_KEY from JWT_SECRET.
//
// Usage:
//   JWT_SECRET=<secret> node local-dev/mint-jwt.mjs anon
//   JWT_SECRET=<secret> node local-dev/mint-jwt.mjs service_role
import { createHmac } from "node:crypto";

const role = process.argv[2];
if (role !== "anon" && role !== "service_role") {
  console.error("Role must be 'anon' or 'service_role'");
  process.exit(1);
}
const secret = process.env.JWT_SECRET;
if (!secret) { console.error("JWT_SECRET required"); process.exit(1); }

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
const payload = b64url(JSON.stringify({
  role,
  iss: "supabase",
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365 * 10,
}));
const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
process.stdout.write(`${header}.${payload}.${signature}`);
