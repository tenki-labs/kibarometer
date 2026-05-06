// lib/admin/legacy/brreg-client.js
// Thin client for Brønnøysundregistrene's open Enhetsregisteret + Roller
// APIs. NLOD 2.0 open data, no auth required. Self-identifies via
// User-Agent per brreg's etiquette guidance, paces requests to ~4/sec,
// retries 5xx + 429 with exponential backoff.
//
// Docs: https://data.brreg.no/enhetsregisteret/api/dokumentasjon/no/index.html
// Endpoints used:
//   GET /enhetsregisteret/api/enheter         — list with date filter
//   GET /enhetsregisteret/api/enheter/{n}/roller — role-holders
//
// Pagination: brreg returns up to ~10 000 results per query. Each response
// carries `_links.next` and a `page` envelope with `totalPages` /
// `totalElements`. Forward callers walk page=0..totalPages-1 within the
// 10 k cap; for wider windows (e.g. backfill since 2018-01-01) use the
// bulk dump in PR 4 instead of paging this endpoint to exhaustion.

const DEFAULT_BASE = "https://data.brreg.no/enhetsregisteret/api";
const USER_AGENT =
  "kibarometerbot/1.0 (+https://kibarometer.no/about/bot; nlod-attribution=brreg)";

function baseUrl() {
  return process.env.BRREG_BASE_URL || DEFAULT_BASE;
}

// Polite pacing: ~4 req/sec sustained. brreg has no published rate limit
// but their docs ask operators to use the bulk dump for bulk work; this
// pace keeps us well clear of any soft caps for daily-forward + role
// fetching at K=50/tick.
const POLITE_DELAY_MS = 250;
let lastRequestAt = 0;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function politeWait() {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < POLITE_DELAY_MS) await sleep(POLITE_DELAY_MS - elapsed);
  lastRequestAt = Date.now();
}

// Fetch with retry. Returns { http_status, payload, duration_ms }.
// Retries 429 + 5xx up to 4 attempts with exponential backoff (1s, 2s, 4s).
// 4xx other than 429 → fail-fast (caller decides).
async function brregFetch(path) {
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
      // Network error: same backoff as 5xx.
      await sleep(backoff);
      backoff *= 2;
      attempt += 1;
      continue;
    }
    const duration_ms = Date.now() - t0;
    lastStatus = res.status;
    if (res.ok) {
      const payload = await res.json();
      return { http_status: res.status, payload, duration_ms };
    }
    // Retryable
    if (res.status >= 500 || res.status === 429) {
      const ra = parseInt(res.headers.get("retry-after") || "", 10);
      const wait = !Number.isNaN(ra) ? ra * 1000 : backoff;
      await sleep(wait);
      backoff *= 2;
      attempt += 1;
      continue;
    }
    // 4xx other than 429: caller decides. 404 on /roller is normal
    // (entity has no registered roles).
    return { http_status: res.status, payload: null, duration_ms };
  }
  throw new Error(`brreg ${path}: exhausted retries (last status ${lastStatus})`);
}

// Fetch one page of /enheter filtered by registration date.
// `fromDate` (required) and `toDate` (optional) are ISO YYYY-MM-DD strings.
export async function fetchEnheterPage({ fromDate, toDate, page = 0, size = 1000 } = {}) {
  if (!fromDate) throw new Error("fetchEnheterPage: fromDate is required");
  const params = new URLSearchParams();
  params.set("fraRegistreringsdatoEnhetsregisteret", fromDate);
  if (toDate) params.set("tilRegistreringsdatoEnhetsregisteret", toDate);
  params.set("size", String(size));
  params.set("page", String(page));
  return brregFetch(`/enheter?${params.toString()}`);
}

// Walk pages forward from page=0 calling `onPage(enheter[], pageIdx, pageEnvelope)`
// for each. Stops when totalPages is reached, the budget is exhausted, or
// onPage throws.
export async function fetchEnheterBatch({
  fromDate,
  toDate,
  size = 1000,
  maxPages = 50,
  maxWallMs = 90_000,
  onPage,
} = {}) {
  if (typeof onPage !== "function") throw new Error("fetchEnheterBatch: onPage is required");
  if (!fromDate) throw new Error("fetchEnheterBatch: fromDate is required");
  const start = Date.now();
  let page = 0;
  let totalItems = 0;
  let totalElements = null;
  while (page < maxPages && Date.now() - start < maxWallMs) {
    const r = await fetchEnheterPage({ fromDate, toDate, page, size });
    if (r.http_status !== 200) {
      throw new Error(`brreg /enheter HTTP ${r.http_status} at page=${page}`);
    }
    const enheter = r.payload?._embedded?.enheter || [];
    if (totalElements === null) totalElements = r.payload?.page?.totalElements ?? null;
    totalItems += enheter.length;
    await onPage(enheter, page, r.payload?.page);
    const totalPages = r.payload?.page?.totalPages ?? 0;
    if (page + 1 >= totalPages || enheter.length === 0) {
      return { pagesFetched: page + 1, totalItems, totalElements, completed: true };
    }
    page += 1;
  }
  return { pagesFetched: page, totalItems, totalElements, completed: false };
}

// Fetch the role-holders for one orgnr. Returns the brregFetch result
// shape; callers should check `http_status === 200` and only persist
// roles when payload is present. 404 → entity has no registered roles
// (common for ENK without active filings).
export async function fetchRollerForOrgnr(orgnr) {
  if (!orgnr) throw new Error("fetchRollerForOrgnr: orgnr is required");
  return brregFetch(`/enheter/${encodeURIComponent(orgnr)}/roller`);
}
