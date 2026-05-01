// scripts/nav/client.js
// Thin client for NAV's Stillingsfeed (job-vacancy public feed).
// Docs: https://navikt.github.io/pam-stilling-feed/
// Endpoint: GET https://pam-stilling-feed.nav.no/api/v1/feed
// Auth: bearer token. The PUBLIC token at /api/publicToken rotates at
// irregular intervals; we fetch it on-the-fly so rotation is invisible.
// For production, register at nav.team.arbeidsplassen@nav.no for a private
// token and set NAV_FEED_TOKEN to skip the dynamic fetch.

const DEFAULT_BASE = "https://pam-stilling-feed.nav.no";

function baseUrl() {
  return process.env.NAV_FEED_BASE_URL || DEFAULT_BASE;
}

async function getToken() {
  const env = process.env.NAV_FEED_TOKEN;
  if (env) return env;
  const res = await fetch(`${baseUrl()}/api/publicToken`);
  if (!res.ok) throw new Error(`NAV publicToken → ${res.status}`);
  const text = await res.text();
  const match = text.match(/eyJ[A-Za-z0-9_.-]+/);
  if (!match) throw new Error(`NAV publicToken response missing JWT: ${text.slice(0, 120)}`);
  return match[0];
}

// Fetch one page from the Stillingsfeed.
// Pass `cursor` (a `next_id` from a previous response) to advance through the
// feed; omit to fetch the latest page.
export async function fetchStillingsfeed({ cursor } = {}) {
  const token = await getToken();
  const path = cursor ? `/api/v1/feed/${encodeURIComponent(cursor)}` : "/api/v1/feed";
  const url = `${baseUrl()}${path}`;
  const t0 = Date.now();
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": "kibarometer/1.0 (+https://kibarometer.no)",
    },
  });
  const text = await res.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { _raw: text.slice(0, 2000) }; }
  return {
    endpoint: url,
    params: { cursor: cursor || null },
    payload,
    http_status: res.status,
    duration_ms: Date.now() - t0,
  };
}
