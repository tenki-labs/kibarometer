// lib/admin/legacy/storting-client.js
// Thin client for data.stortinget.no's open eksport API. NLOD open data,
// no auth required. Self-identifies via User-Agent, paces requests so we
// stay well clear of the rate limit the API documented in Sept 2025.
//
// Docs: https://data.stortinget.no/dokumentasjon-og-hjelp/
// Endpoints used:
//   GET /eksport/saker?sesjonid=YYYY-YYYY&format=json        → cases
//   GET /eksport/stortingsvedtak?sesjonid=YYYY-YYYY&format=json → resolutions
//
// Response shapes verified live 2026-05-12:
//   /saker      → { respons_dato_tid, versjon, saker_liste: [...] }
//   /vedtak     → { respons_dato_tid, versjon, sesjon_id, stortingsvedtak_liste: [...] }
//
// Pagination: not used. Each session's saker / vedtak come back in one
// response (per-session volume is small — ~hundreds of saker, similar
// for vedtak — so the whole response fits comfortably).

const DEFAULT_BASE = "https://data.stortinget.no";
const USER_AGENT =
  "kibarometerbot/1.0 (+https://kibarometer.no/about/bot; nlod-attribution=stortinget)";

function baseUrl() {
  return process.env.STORTING_BASE_URL || DEFAULT_BASE;
}

// Polite pacing: ~2 req/sec. Daily cron only hits the API a handful of times
// (1 saker + 1 vedtak for the active session). Backfill walks 7-8 sessions
// once, so this only matters when the operator triggers a manual full
// backfill. The Sept 2025 rate-limit notice didn't publish hard numbers; 2 rps
// is well under any reasonable cap.
const POLITE_DELAY_MS = 500;
let lastRequestAt = 0;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function politeWait() {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < POLITE_DELAY_MS) await sleep(POLITE_DELAY_MS - elapsed);
  lastRequestAt = Date.now();
}

// Fetch with retry. Returns { http_status, payload, duration_ms }. Retries
// 5xx + 429 up to 4 attempts with exponential backoff (1s, 2s, 4s). 4xx
// other than 429 → fail-fast (caller decides). Mirrors brregFetch shape.
async function stortingFetch(path) {
  await politeWait();
  let attempt = 0;
  let backoff = 1000;
  let lastStatus = 0;
  while (attempt < 4) {
    const t0 = Date.now();
    let res;
    try {
      res = await fetch(`${baseUrl()}${path}`, {
        headers: {
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
      });
    } catch (err) {
      await sleep(backoff);
      backoff *= 2;
      attempt += 1;
      continue;
    }
    const duration_ms = Date.now() - t0;
    lastStatus = res.status;
    if (res.ok) {
      // data.stortinget.no occasionally serves text/html on errors even with
      // ?format=json. Defensively check content-type before parsing JSON.
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("json")) {
        // Treat as retryable transient — the API has been known to return
        // an HTML error envelope when overloaded.
        await sleep(backoff);
        backoff *= 2;
        attempt += 1;
        continue;
      }
      const payload = await res.json();
      return { http_status: res.status, payload, duration_ms };
    }
    if (res.status >= 500 || res.status === 429) {
      const ra = parseInt(res.headers.get("retry-after") || "", 10);
      const wait = !Number.isNaN(ra) ? ra * 1000 : backoff;
      await sleep(wait);
      backoff *= 2;
      attempt += 1;
      continue;
    }
    return { http_status: res.status, payload: null, duration_ms };
  }
  throw new Error(`stortinget ${path}: exhausted retries (last status ${lastStatus})`);
}

// Fetch all saker (cases) for one parliamentary session. Returns the array
// from `saker_liste`, or [] when the session has no AI-relevant data yet
// (the matcher decides relevance downstream, not this client).
//
// sessionId format: "YYYY-YYYY" (e.g. "2024-2025"). The Stortinget year
// runs October → September.
export async function fetchSakerForSession(sessionId) {
  if (!sessionId) throw new Error("fetchSakerForSession: sessionId is required");
  const path = `/eksport/saker?sesjonid=${encodeURIComponent(sessionId)}&format=json`;
  const r = await stortingFetch(path);
  if (r.http_status !== 200 || !r.payload) {
    throw new Error(`stortinget /saker HTTP ${r.http_status} for ${sessionId}`);
  }
  const saker = Array.isArray(r.payload?.saker_liste) ? r.payload.saker_liste : [];
  return { saker, fetched_at: r.payload?.respons_dato_tid || null, duration_ms: r.duration_ms };
}

// Fetch all vedtak (resolutions) for one session. Returns the array from
// `stortingsvedtak_liste`. Each vedtak carries `sak_id` linking back to a
// row in storting_saker.
export async function fetchVedtakForSession(sessionId) {
  if (!sessionId) throw new Error("fetchVedtakForSession: sessionId is required");
  const path = `/eksport/stortingsvedtak?sesjonid=${encodeURIComponent(sessionId)}&format=json`;
  const r = await stortingFetch(path);
  if (r.http_status !== 200 || !r.payload) {
    throw new Error(`stortinget /vedtak HTTP ${r.http_status} for ${sessionId}`);
  }
  const vedtak = Array.isArray(r.payload?.stortingsvedtak_liste)
    ? r.payload.stortingsvedtak_liste
    : [];
  return { vedtak, fetched_at: r.payload?.respons_dato_tid || null, duration_ms: r.duration_ms };
}

// Compute the current Stortinget session id. The parliamentary year runs
// October → September. A date in October 2024 sits in session "2024-2025";
// a date in May 2025 also sits in session "2024-2025". September is a
// boundary month — it's still in the previous session.
//
// Used by the daily cron handler so it doesn't need to know about the
// calendar. Returns a string "YYYY-YYYY".
export function currentSessionId(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-indexed: 0=Jan, 9=Oct
  if (m >= 9) {
    return `${y}-${y + 1}`;
  }
  return `${y - 1}-${y}`;
}

// Walk session IDs from `from` back to `to` inclusive. Used by the backfill
// runner to enumerate sessions to fetch. e.g. enumerateSessions("2025-2026",
// "2018-2019") yields ["2025-2026","2024-2025",...,"2018-2019"].
export function enumerateSessions(fromSession, toSession) {
  const parse = (s) => {
    const parts = String(s).split("-");
    if (parts.length !== 2) throw new Error(`invalid session id: ${s}`);
    return parseInt(parts[0], 10);
  };
  const fromY = parse(fromSession);
  const toY = parse(toSession);
  if (Number.isNaN(fromY) || Number.isNaN(toY)) {
    throw new Error(`enumerateSessions: bad inputs ${fromSession} → ${toSession}`);
  }
  const out = [];
  const step = fromY >= toY ? -1 : 1;
  for (let y = fromY; step > 0 ? y <= toY : y >= toY; y += step) {
    out.push(`${y}-${y + 1}`);
  }
  return out;
}
