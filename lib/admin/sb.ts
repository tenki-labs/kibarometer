// Service-role PostgREST client for the admin. Mirrors the legacy
// scripts/admin-server.js:76-97 sbFetch signature so the legacy/*.js
// orchestrators (loaded by app/admin/api/jobs/*/route.ts and the page
// actions) can call it as `sb` without changes.
//
// Different module from lib/supabase.ts on purpose: that one is anon-key +
// ISR for marketing reads; this one is service-role + no-store for admin
// writes / privileged reads. Don't merge them.

import "server-only";

type SbInit = {
  token?: string;
  service?: boolean;
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  prefer?: string;
};

export async function sbFetch<T = unknown>(
  path: string,
  {
    token,
    service = false,
    method = "GET",
    body,
    headers = {},
    prefer,
  }: SbInit = {},
): Promise<T> {
  const SUPABASE_URL = process.env.SUPABASE_INTERNAL_URL!;
  const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const apikey = service ? SUPABASE_SERVICE_ROLE_KEY : SUPABASE_ANON_KEY;
  const authToken = service ? SUPABASE_SERVICE_ROLE_KEY : token;
  const h: Record<string, string> = {
    apikey,
    Authorization: `Bearer ${authToken}`,
    "Content-Type": "application/json",
    ...headers,
  };
  if (prefer) h.Prefer = prefer;

  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const msg =
      (typeof data === "object" && data && "message" in data
        ? (data as { message: string }).message
        : null) || text || res.statusText;
    throw new Error(`PostgREST ${method} ${path} → ${res.status}: ${msg}`);
  }
  return data as T;
}
