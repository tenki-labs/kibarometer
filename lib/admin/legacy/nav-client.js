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
// feed; omit to fetch the oldest page (the feed is append-only, walked
// forward from 2023-06 toward present — bare /api/v1/feed = page 1).
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

// Self-documenting alias: the bare /api/v1/feed IS the first (oldest) page.
// Backfill starts here and walks forward via next_id until null.
export async function fetchStillingsfeedFirst() {
  return fetchStillingsfeed();
}

// Fetch one posting's detail. ACTIVE postings return a `json` field with the
// full ad (description, employer, locations, occupation categories etc.).
// INACTIVE postings return only {uuid, status, sistEndret} — caller must
// check `status` before extracting detail fields.
export async function fetchFeedentry(uuid) {
  const token = await getToken();
  const url = `${baseUrl()}/api/v1/feedentry/${encodeURIComponent(uuid)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": "kibarometer/1.0 (+https://kibarometer.no)",
    },
  });
  const text = await res.text();
  let detail = null;
  try { detail = JSON.parse(text); } catch { detail = null; }
  return { http_status: res.status, detail };
}

// Walk pages forward from `cursor`, calling `onPage(result)` for each. Stops on
// any of: budget exhausted (`maxPages` or `maxWallMs`), `next_id` becomes null
// (caught up to live head), or `onPage` throws (propagates after recording the
// last successful cursor).
//
// `cursor=null` starts from the oldest page (2023-06). On success, the caller
// should persist `nextCursor` (or null if `completed`) so the next batch
// resumes where this one stopped. Pages are streamed one at a time so callers
// can write incrementally without buffering the whole batch in memory.
export async function fetchStillingsfeedBatch({
  cursor = null,
  maxPages = 50,
  maxWallMs = 60_000,
  onPage,
} = {}) {
  if (typeof onPage !== "function") throw new Error("fetchStillingsfeedBatch: onPage is required");
  const start = Date.now();
  let current = cursor;
  let pagesFetched = 0;
  let itemsFetched = 0;
  let lastEventAt = null;
  let completed = false;
  let nextCursor = current;
  // Track the immutable id of each page we fetch (NAV exposes it as
  // payload.id). The orchestrator persists the last one as `tail_cursor`
  // so the next tick can re-poll the head page — NAV's docs say new events
  // either append to the current head page or chain a new page from it,
  // and re-fetching the head is the documented way to see both.
  let lastPageId = null;

  while (pagesFetched < maxPages && Date.now() - start < maxWallMs) {
    const result = await fetchStillingsfeed({ cursor: current });
    if (result.http_status < 200 || result.http_status >= 300) {
      throw new Error(`NAV feed HTTP ${result.http_status} at cursor=${current ?? "(first)"}`);
    }
    await onPage(result);
    pagesFetched += 1;
    lastPageId = result.payload?.id ?? lastPageId;

    const items = Array.isArray(result.payload?.items) ? result.payload.items : [];
    itemsFetched += items.length;
    for (const it of items) {
      const t = it?.date_modified || it?._feed_entry?.sistEndret;
      if (t && (!lastEventAt || t > lastEventAt)) lastEventAt = t;
    }

    nextCursor = result.payload?.next_id ?? null;
    if (!nextCursor || nextCursor === current) {
      completed = true;
      break;
    }
    current = nextCursor;
  }

  return { pagesFetched, itemsFetched, lastCursor: current, nextCursor, completed, lastEventAt, lastPageId };
}
