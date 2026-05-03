// lib/admin/umami.ts — server-side Umami API client used by /admin/analytics.
//
// Auth model: self-hosted Umami has no API-keys feature in any version (it's
// cloud-only), so we use the same flow Umami's own dashboard uses:
// POST /api/auth/login with {username, password} returns a JWT bearer token
// signed with Umami's APP_SECRET. We cache that token in-memory for 50 min
// (Umami's default expiry is 24 h — staying well under it). On 401 we drop
// the cache and re-login once.
//
// Env vars (all optional — when missing, umamiConfigured() returns null and
// the page renders a "not configured" runbook):
//   UMAMI_INTERNAL_URL  — defaults to http://kiba-umami:3000
//   UMAMI_USERNAME      — Umami login username (e.g. "admin")
//   UMAMI_PASSWORD      — Umami login password
//   UMAMI_WEBSITE_ID    — UUID of the website registered in Umami's UI

import "server-only";

const ENDPOINT =
  process.env.UMAMI_INTERNAL_URL || "http://kiba-umami:3000";

// Token cache. Module-scoped — survives across requests within one Next.js
// process. Re-minted on miss / on 401.
const TOKEN_TTL_MS = 50 * 60 * 1000;
let tokenCache: { token: string; expiresAt: number } | null = null;

export type UmamiConfig = {
  endpoint: string;
  websiteId: string;
};

export function umamiConfigured(): UmamiConfig | null {
  const username = process.env.UMAMI_USERNAME;
  const password = process.env.UMAMI_PASSWORD;
  const websiteId = process.env.UMAMI_WEBSITE_ID;
  if (!username || !password || !websiteId) return null;
  return { endpoint: ENDPOINT, websiteId };
}

async function login(force = false): Promise<string> {
  if (!force && tokenCache && tokenCache.expiresAt > Date.now()) {
    return tokenCache.token;
  }
  const username = process.env.UMAMI_USERNAME;
  const password = process.env.UMAMI_PASSWORD;
  if (!username || !password) {
    throw new Error("UMAMI_USERNAME / UMAMI_PASSWORD missing");
  }
  const res = await fetch(`${ENDPOINT}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
    cache: "no-store",
  });
  if (!res.ok) {
    tokenCache = null;
    const body = await res.text().catch(() => "");
    throw new Error(`Umami login ${res.status}: ${body.slice(0, 200)}`);
  }
  const { token } = (await res.json()) as { token: string };
  tokenCache = { token, expiresAt: Date.now() + TOKEN_TTL_MS };
  return token;
}

async function um<T>(
  cfg: UmamiConfig,
  path: string,
  query: Record<string, string | number | undefined> = {},
): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const url = `${cfg.endpoint}${path}${qs.size ? `?${qs}` : ""}`;
  const call = async (token: string) =>
    fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
  let res = await call(await login());
  // One retry on 401 — covers the case where the cached token expired
  // server-side before our TTL elapsed (APP_SECRET rotated, container
  // restarted, etc.).
  if (res.status === 401) {
    tokenCache = null;
    res = await call(await login(true));
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Umami ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

// Umami v3 changed the stats response shape vs v2: flat numbers + a single
// `comparison` object (previous-period values) instead of {value, prev} per
// metric. We flatten the prior-period back into a {value, prev}-shaped view
// in `getStats()` so the page code stays simple.
type UmamiStatsRaw = {
  pageviews: number;
  visitors: number;
  visits: number;
  bounces: number;
  totaltime: number;
  comparison?: {
    pageviews?: number;
    visitors?: number;
    visits?: number;
    bounces?: number;
    totaltime?: number;
  };
};

export type UmamiStats = {
  pageviews: { value: number; prev: number };
  visitors: { value: number; prev: number };
  visits: { value: number; prev: number };
  bounces: { value: number; prev: number };
  totaltime: { value: number; prev: number };
};

export type UmamiMetric = { x: string; y: number };

export type UmamiPageviewSeries = {
  pageviews: { x: string; y: number }[];
  sessions: { x: string; y: number }[];
};

const RANGE_TO_MS: Record<string, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

export function rangeToWindow(range: string): {
  startAt: number;
  endAt: number;
  unit: "hour" | "day";
} {
  const ms = RANGE_TO_MS[range] ?? RANGE_TO_MS["7d"];
  const endAt = Date.now();
  const startAt = endAt - ms;
  return { startAt, endAt, unit: range === "24h" ? "hour" : "day" };
}

export async function getStats(cfg: UmamiConfig, range: string): Promise<UmamiStats> {
  const { startAt, endAt } = rangeToWindow(range);
  // Pass `compare=prev` so v3 includes the previous-period numbers under
  // `comparison`. Without it, comparison is omitted and diffHint shows "—".
  const raw = await um<UmamiStatsRaw>(cfg, `/api/websites/${cfg.websiteId}/stats`, {
    startAt,
    endAt,
    compare: "prev",
  });
  const prev = raw.comparison ?? {};
  const pair = (curr: number, p?: number) => ({ value: curr ?? 0, prev: p ?? 0 });
  return {
    pageviews: pair(raw.pageviews, prev.pageviews),
    visitors: pair(raw.visitors, prev.visitors),
    visits: pair(raw.visits, prev.visits),
    bounces: pair(raw.bounces, prev.bounces),
    totaltime: pair(raw.totaltime, prev.totaltime),
  };
}

export async function getPageviewSeries(
  cfg: UmamiConfig,
  range: string,
): Promise<UmamiPageviewSeries> {
  const { startAt, endAt, unit } = rangeToWindow(range);
  return um<UmamiPageviewSeries>(cfg, `/api/websites/${cfg.websiteId}/pageviews`, {
    startAt,
    endAt,
    unit,
    timezone: "Europe/Oslo",
  });
}

// v3 renamed the URL/path metric type from "url" to "path". The other types
// (referrer/country/browser/os) kept their names. We accept the v3 spelling.
export async function getMetric(
  cfg: UmamiConfig,
  range: string,
  type: "path" | "referrer" | "country" | "browser" | "os",
  limit = 10,
): Promise<UmamiMetric[]> {
  const { startAt, endAt } = rangeToWindow(range);
  return um<UmamiMetric[]>(cfg, `/api/websites/${cfg.websiteId}/metrics`, {
    startAt,
    endAt,
    type,
    limit,
  });
}
