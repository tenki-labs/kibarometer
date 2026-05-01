#!/usr/bin/env node
// Create (or upsert) a super_admin user in the local Supabase via the Auth admin API.
// Reads SUPABASE_URL + SERVICE_ROLE_KEY from the environment.
//
// Usage:
//   SUPABASE_URL=http://localhost:8000 \
//   SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY \
//     node local-dev/create-admin-user.mjs me@local.test localdev123 "Local Admin"
const [, , email, password, fullName = "Local Admin"] = process.argv;
if (!email || !password) {
  console.error("Usage: create-admin-user.mjs <email> <password> [full_name]");
  process.exit(1);
}
const SUPABASE_URL = process.env.SUPABASE_URL;
const KEY = process.env.SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !KEY) {
  console.error("SUPABASE_URL and SERVICE_ROLE_KEY env vars are required.");
  process.exit(1);
}

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
};

const body = {
  email, password,
  email_confirm: true,
  user_metadata: { full_name: fullName, role: "super_admin" },
};

const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: "POST", headers, body: JSON.stringify(body),
});
const text = await res.text();
let data; try { data = JSON.parse(text); } catch { data = text; }

if (!res.ok && data?.code === "email_exists") {
  console.error(`[create-admin-user] ${email} exists; upserting metadata.`);
  const list = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, { headers })
    .then(r => r.json()).catch(() => null);
  const existing = (list?.users || [])[0];
  if (!existing) { console.error("Could not locate existing user."); process.exit(1); }
  const upd = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${existing.id}`, {
    method: "PUT", headers,
    body: JSON.stringify({ password, user_metadata: { full_name: fullName, role: "super_admin" } }),
  });
  if (!upd.ok) { console.error(await upd.text()); process.exit(1); }
  console.log(`Updated ${email} (id=${existing.id}, role=super_admin).`);
  process.exit(0);
}

if (!res.ok) {
  console.error(`Auth admin API ${res.status}:`, data);
  process.exit(1);
}

console.log(`Created ${email} (id=${data.id}, role=super_admin). Log in at http://localhost:4000/admin/login`);
