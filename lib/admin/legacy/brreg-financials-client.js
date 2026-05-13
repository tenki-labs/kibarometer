// lib/admin/legacy/brreg-financials-client.js
// HTTP client for Regnskapsregisteret. NLOD 2.0 open data — same
// User-Agent / pacing etiquette as brreg-client.js for the
// Enhetsregisteret endpoints.
//
// Endpoint: GET /regnskapsregisteret/regnskap/{orgnr}
//   200 + array — one element per filed årsregnskap (typically 1
//        per fiscal year; offset fiscal-year companies may have
//        multiple rows in transition years).
//   404 — company has no filings on record.
//
// Polite pacing matches brreg-client.js (~4 req/sec). Retries 429 +
// 5xx with exponential backoff.

const DEFAULT_BASE = "https://data.brreg.no/regnskapsregisteret";
const USER_AGENT =
  "kibarometerbot/1.0 (+https://kibarometer.no/about/bot; nlod-attribution=brreg)";

const POLITE_DELAY_MS = 250;
let lastRequestAt = 0;

function baseUrl() {
  return process.env.BRREG_REGNSKAP_BASE_URL || DEFAULT_BASE;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function politeWait() {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < POLITE_DELAY_MS) await sleep(POLITE_DELAY_MS - elapsed);
  lastRequestAt = Date.now();
}

// Fetch with retry. Returns { http_status, payload, duration_ms }.
// 404 is non-retryable and returned to the caller — it means the
// company has no filings on record.
export async function fetchFinancialsForOrgnr(orgnr) {
  if (!orgnr || !/^\d{9}$/.test(String(orgnr))) {
    throw new Error(`fetchFinancialsForOrgnr: invalid orgnr ${orgnr}`);
  }
  await politeWait();
  let attempt = 0;
  let backoff = 1000;
  let lastStatus = 0;
  while (attempt < 4) {
    const t0 = Date.now();
    let res;
    try {
      res = await fetch(`${baseUrl()}/regnskap/${orgnr}`, {
        headers: {
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
      });
    } catch {
      // Network error — back off and retry.
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
    // 404 = no filings; non-retryable.
    if (res.status === 404) {
      return { http_status: 404, payload: null, duration_ms };
    }
    // Retryable: 429 + 5xx.
    if (res.status >= 500 || res.status === 429) {
      const ra = parseInt(res.headers.get("retry-after") || "", 10);
      const wait = !Number.isNaN(ra) ? ra * 1000 : backoff;
      await sleep(wait);
      backoff *= 2;
      attempt += 1;
      continue;
    }
    // Other 4xx — caller decides.
    return { http_status: res.status, payload: null, duration_ms };
  }
  throw new Error(
    `regnskap ${orgnr}: exhausted retries (last status ${lastStatus})`,
  );
}
