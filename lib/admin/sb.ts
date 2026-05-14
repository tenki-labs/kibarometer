// Service-role PostgREST client for the admin. Mirrors the legacy
// scripts/admin-server.js:76-97 sbFetch signature so the legacy/*.js
// orchestrators (loaded by app/admin/api/jobs/*/route.ts and the page
// actions) can call it as `sb` without changes.
//
// Different module from lib/supabase.ts on purpose: that one is anon-key +
// ISR for marketing reads; this one is service-role + no-store for admin
// writes / privileged reads. Don't merge them.
//
// Transient-5xx retry policy
// --------------------------
// PostgREST sometimes returns a 502 from Kong mid-backfill (Kong got a bad
// response from postgrest, usually because the upstream was momentarily
// overloaded). One blip shouldn't fail a 5-minute orchestrator run, so:
//   * retryTransient: "auto" (default) — retry 502/503/504 on idempotent
//     methods (GET/PATCH/DELETE/PUT/HEAD). Heartbeats and finishJob PATCHes
//     get this for free.
//   * retryTransient: true — opt-in for non-idempotent calls the caller has
//     reasoned about as safe (e.g. POST upserts with on_conflict +
//     Prefer: "resolution=merge-duplicates").
//   * retryTransient: false — disable entirely.
// Network-level fetch() rejections are retried under the same policy.
// Backoff is short (200ms, 800ms) — postgrest typically recovers within a
// few hundred ms.

import "server-only";

type SbInit = {
  token?: string;
  service?: boolean;
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  prefer?: string;
  retryTransient?: boolean | "auto";
};

const IDEMPOTENT_METHODS = new Set(["GET", "PATCH", "DELETE", "PUT", "HEAD"]);
const RETRIABLE_STATUS = new Set([502, 503, 504]);
const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryRequest(
  method: string,
  retryOpt: boolean | "auto" | undefined,
): boolean {
  if (retryOpt === false) return false;
  if (retryOpt === true) return true;
  // "auto" or undefined — retry only idempotent methods.
  return IDEMPOTENT_METHODS.has(method.toUpperCase());
}

function buildErrorMessage(text: string, statusText: string): string {
  if (!text) return statusText;
  try {
    const data = JSON.parse(text);
    if (data && typeof data === "object" && "message" in data) {
      return String((data as { message: unknown }).message);
    }
  } catch {
    // Fall through to raw text.
  }
  return text;
}

// Long in.(...) filter lists can push the path past 1 KB. Downstream
// storage (jobs.error → 1000 chars, current_step → 200 chars) then chops
// off the status code and PostgREST body, leaving operators staring at a
// truncated URL with no idea what actually failed. Summarize huge paths
// so the diagnostic tail always survives.
function summarizePathForError(path: string): string {
  const MAX = 240;
  if (path.length <= MAX) return path;
  return `${path.slice(0, 160)}…[+${path.length - 200} chars]…${path.slice(-40)}`;
}

export async function sbFetch<T = unknown>(
  path: string,
  {
    token,
    service = false,
    method = "GET",
    body,
    headers = {},
    prefer,
    retryTransient = "auto",
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

  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const bodyJson = body !== undefined ? JSON.stringify(body) : undefined;
  const allowRetry = shouldRetryRequest(method, retryTransient);

  let lastNetworkError: unknown = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: h,
        body: bodyJson,
        cache: "no-store",
      });
    } catch (err) {
      // DNS / TCP reset / connection refused. Same transient class as 5xx.
      lastNetworkError = err;
      if (allowRetry && attempt < MAX_ATTEMPTS - 1) {
        await sleep(BACKOFF_BASE_MS * Math.pow(4, attempt));
        continue;
      }
      throw err;
    }

    if (res.ok) {
      const text = await res.text();
      let data: unknown = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
      return data as T;
    }

    // Non-2xx. Decide whether to retry this status.
    if (
      allowRetry &&
      RETRIABLE_STATUS.has(res.status) &&
      attempt < MAX_ATTEMPTS - 1
    ) {
      // Drain body so the underlying connection can be reused on retry.
      await res.text().catch(() => {});
      await sleep(BACKOFF_BASE_MS * Math.pow(4, attempt));
      continue;
    }

    // Final failure — same error format as the pre-retry version so log
    // grep patterns / dashboards keep working.
    const text = await res.text();
    const msg = buildErrorMessage(text, res.statusText);
    throw new Error(
      `PostgREST ${method} ${summarizePathForError(path)} → ${res.status}: ${msg}`,
    );
  }

  // Defensive: the loop body always either returns, continues, or throws.
  // This statement keeps TS happy when MAX_ATTEMPTS is somehow exhausted
  // without reaching a terminal branch.
  if (lastNetworkError instanceof Error) throw lastNetworkError;
  throw new Error(`PostgREST ${method} ${path}: exhausted retries`);
}
