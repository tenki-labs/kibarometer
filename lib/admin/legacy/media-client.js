// lib/admin/legacy/media-client.js
// HTTP wrapper used by the media discover / fetch-classify pipelines. Mirrors
// `nav-client.js`'s self-identifying UA and retry shape; adds two things NAV
// doesn't need: per-host rate-limiting (we crawl outlets, not a single API)
// and robots.txt enforcement.
//
// Three callable surfaces:
//   politeFetch(url, opts) — single GET with UA, robots check, rate-limit,
//     retry-once on 5xx/network. Returns { ok, status, headers, body, ... }.
//   fetchHtml(url, opts) — politeFetch wrapper that requires text/html-ish
//     responses and exposes `body` as a string.
//   fetchSitemap(url, opts) — same as fetchHtml but accepts xml MIME types.
//
// We do NOT throw on disallowed URLs — caller decides whether to discard or
// log. The result carries `disallowed: true` and an empty body.

import { getRobots, isAllowed, DEFAULT_UA_TOKEN } from "./media-robots.js";

const DEFAULT_UA = `${DEFAULT_UA_TOKEN}/1.0 (+https://kibarometer.no/about/bot)`;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_CRAWL_DELAY_MS = 1000;
const RETRY_BASE_MS = 800;

// Per-host last-fetch timestamp. We delay subsequent requests to the same
// host until at least `crawlDelayMs` has elapsed since the previous one.
// In-process only — fine for the cron worker (single Node process), would
// need Redis if we ever fanned out across replicas.
const lastFetchAt = new Map();

async function rateLimit(host, crawlDelayMs) {
  const last = lastFetchAt.get(host);
  if (last) {
    const wait = last + crawlDelayMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  lastFetchAt.set(host, Date.now());
}

function withTimeout(ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error("timeout")), ms);
  return { signal: ctrl.signal, cancel: () => clearTimeout(timer) };
}

// One attempt. Caller handles retry policy. Returns a structured result
// rather than the Response object so retry logic doesn't have to worry
// about already-consumed bodies.
async function attemptFetch(url, { ua, timeoutMs, accept, fetcher }) {
  const t0 = Date.now();
  const { signal, cancel } = withTimeout(timeoutMs);
  try {
    const res = await fetcher(url, {
      headers: {
        "User-Agent": ua,
        Accept: accept,
        "Accept-Language": "no,nb;q=0.9,nn;q=0.8,en;q=0.5",
      },
      redirect: "follow",
      signal,
    });
    const body = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      headers: Object.fromEntries(res.headers),
      body,
      url: res.url || url,
      duration_ms: Date.now() - t0,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      headers: {},
      body: "",
      url,
      duration_ms: Date.now() - t0,
      error: err?.message || String(err),
    };
  } finally {
    cancel();
  }
}

// Single URL fetch with the full politeness stack. `crawlDelayMs` should be
// the source's `media_sources.crawl_delay_ms` so per-source overrides flow
// through cleanly — robots.txt's Crawl-delay is taken as a floor.
export async function politeFetch(url, {
  ua = DEFAULT_UA,
  crawlDelayMs = DEFAULT_CRAWL_DELAY_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5",
  fetcher = fetch,
  checkRobots = true,
} = {}) {
  let host;
  try {
    host = new URL(url).host;
  } catch {
    return { ok: false, status: 0, headers: {}, body: "", url, duration_ms: 0, error: "invalid_url" };
  }

  if (checkRobots) {
    const robots = await getRobots({ host, fetcher, ua });
    if (!isAllowed(robots, ua, url)) {
      return {
        ok: false,
        status: 0,
        headers: {},
        body: "",
        url,
        duration_ms: 0,
        disallowed: true,
        error: "robots_disallow",
      };
    }
    if (robots.crawlDelayMs && robots.crawlDelayMs > crawlDelayMs) {
      crawlDelayMs = robots.crawlDelayMs;
    }
  }

  await rateLimit(host, crawlDelayMs);

  let result = await attemptFetch(url, { ua, timeoutMs, accept, fetcher });
  // Retry once on 5xx or network error. 4xx is a real answer (404, 403, 410)
  // — no retry. Backoff is short because the fetch-classify worker has its
  // own wall-time budget per tick.
  if (!result.ok && (result.status === 0 || result.status >= 500)) {
    await new Promise((r) => setTimeout(r, RETRY_BASE_MS));
    await rateLimit(host, crawlDelayMs);
    result = await attemptFetch(url, { ua, timeoutMs, accept, fetcher });
  }
  return result;
}

export async function fetchHtml(url, opts = {}) {
  return politeFetch(url, {
    ...opts,
    accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
  });
}

export async function fetchSitemap(url, opts = {}) {
  return politeFetch(url, {
    ...opts,
    accept: "application/xml,text/xml;q=0.9,*/*;q=0.5",
  });
}

export function _resetRateLimitForTests() {
  lastFetchAt.clear();
}

export const DEFAULT_USER_AGENT = DEFAULT_UA;
