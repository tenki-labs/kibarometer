// lib/admin/legacy/nav-archive-sources.js
// Thin clients for the three places an arbeidsplassen.nav.no ad page can
// still be read after NAV's feed API has stopped returning its text:
//
//   live        arbeidsplassen.nav.no serves INACTIVE ads for ~5 months
//               after `expires` (measured 2026-09-13). robots.txt allows all.
//   commoncrawl index.commoncrawl.org lists captures per crawl (paginated);
//               data.commoncrawl.org serves the gzipped WARC record by
//               byte range. No auth, no documented rate limit — be polite.
//   wayback     web.archive.org/cdx lists captures; /web/<ts>id_/<url>
//               returns the raw capture. Throttles bursts with 429.
//
// Every function takes an injectable `fetcher` (defaults to global fetch)
// so the orchestrator tests never touch the network. Pacing/sleeping is
// the orchestrator's job, not this module's.

import { gunzipSync } from "node:zlib";

export const USER_AGENT = "kibarometer/1.0 (+https://kibarometer.no)";
export const AD_PAGE_BASE = "https://arbeidsplassen.nav.no/stillinger/stilling/";
export const AD_PAGE_PREFIX = "arbeidsplassen.nav.no/stillinger/stilling/*";
export const CC_INDEX_BASE = "https://index.commoncrawl.org";
export const CC_DATA_BASE = "https://data.commoncrawl.org";
export const WAYBACK_CDX = "https://web.archive.org/cdx/search/cdx";
export const WAYBACK_WEB = "https://web.archive.org/web";

// Oldest crawl / month the indexer looks at. Postings before 2024 are out
// of scope for the analysis and the feed itself only starts 2023-06.
export const ARCHIVE_FLOOR_YEAR = 2024;

const UUID_RE = /\/stillinger\/stilling\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i;

function headers(extra = {}) {
  return { "User-Agent": USER_AGENT, ...extra };
}

// ---- live page ------------------------------------------------------------

export function adPageUrl(id) {
  return `${AD_PAGE_BASE}${encodeURIComponent(id)}`;
}

export async function fetchLiveAdPage(id, { fetcher = fetch } = {}) {
  const res = await fetcher(adPageUrl(id), { headers: headers({ Accept: "text/html" }), redirect: "follow" });
  const html = res.status === 200 ? await res.text() : null;
  return { http_status: res.status, html };
}

// ---- Common Crawl ---------------------------------------------------------

export async function listCcCrawls({ fetcher = fetch } = {}) {
  const res = await fetcher(`${CC_INDEX_BASE}/collinfo.json`, { headers: headers() });
  if (!res.ok) throw new Error(`commoncrawl collinfo → ${res.status}`);
  const list = await res.json();
  return (Array.isArray(list) ? list : [])
    .map((c) => String(c?.id || ""))
    .filter((id) => {
      const m = /^CC-MAIN-(\d{4})-\d{2}$/.exec(id);
      return m && Number(m[1]) >= ARCHIVE_FLOOR_YEAR;
    })
    .sort();
}

function ccIndexUrl(crawl, params) {
  const qs = new URLSearchParams({ url: AD_PAGE_PREFIX, output: "json", ...params });
  return `${CC_INDEX_BASE}/${encodeURIComponent(crawl)}-index?${qs}`;
}

export async function fetchCcIndexPageCount(crawl, { fetcher = fetch } = {}) {
  const res = await fetcher(ccIndexUrl(crawl, { showNumPages: "true" }), { headers: headers() });
  if (!res.ok) throw new Error(`commoncrawl ${crawl} showNumPages → ${res.status}`);
  const body = await res.json();
  const pages = Number(body?.pages);
  return Number.isFinite(pages) && pages >= 0 ? pages : 0;
}

export async function fetchCcIndexPage(crawl, page, { fetcher = fetch } = {}) {
  const res = await fetcher(ccIndexUrl(crawl, { filter: "status:200", page: String(page) }), { headers: headers() });
  // The index answers 404 for "no captures in this crawl" — not an error.
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`commoncrawl ${crawl} page ${page} → ${res.status}`);
  return parseCcIndexLines(await res.text(), crawl);
}

// One JSON object per line. Keep only successful HTML captures of a real
// ad URL (uuid path segment); query-string variants of the same ad are
// fine — the page renders the same ad.
export function parseCcIndexLines(text, crawl) {
  const rows = [];
  for (const line of String(text || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec;
    try {
      rec = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (String(rec.status) !== "200") continue;
    if (rec.mime && !String(rec.mime).includes("html")) continue;
    const m = UUID_RE.exec(String(rec.url || ""));
    if (!m) continue;
    const captured_at = cdxTimestampToIso(rec.timestamp);
    if (!captured_at) continue;
    rows.push({
      id: m[1].toLowerCase(),
      source: "commoncrawl",
      captured_at,
      locator: {
        crawl,
        filename: String(rec.filename || ""),
        offset: Number(rec.offset),
        length: Number(rec.length),
      },
    });
  }
  return rows;
}

// Range-fetch one WARC record (a standalone gzip member), then peel off the
// WARC header block and the captured HTTP head to get the page body.
export async function fetchCcWarcRecord(locator, { fetcher = fetch } = {}) {
  const { filename, offset, length } = locator || {};
  const res = await fetcher(`${CC_DATA_BASE}/${filename}`, {
    headers: headers({ Range: `bytes=${offset}-${offset + length - 1}` }),
  });
  if (res.status !== 200 && res.status !== 206) return { http_status: res.status, html: null };
  const raw = Buffer.from(await res.arrayBuffer());
  let record;
  try {
    record = gunzipSync(raw);
  } catch {
    return { http_status: 0, html: null };
  }
  // WARC headers end at the first blank line. Content-Length there is the
  // exact size of the captured HTTP message; the record is padded with a
  // trailing CRLFCRLF that must not leak into the body (it breaks gunzip).
  const warcEnd = indexOfBlankLine(record, 0);
  if (warcEnd === -1) return { http_status: 0, html: null };
  const warcHead = record.subarray(0, warcEnd).toString("latin1");
  const lenMatch = /^content-length:\s*(\d+)/im.exec(warcHead);
  const httpStart = warcEnd + 4;
  const httpStop = lenMatch ? Math.min(record.length, httpStart + Number(lenMatch[1])) : record.length;
  const message = record.subarray(httpStart, httpStop);
  const httpEnd = indexOfBlankLine(message, 0);
  if (httpEnd === -1) return { http_status: 0, html: null };
  const head = message.subarray(0, httpEnd).toString("latin1");
  const statusMatch = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(head);
  const http_status = statusMatch ? Number(statusMatch[1]) : 0;
  if (http_status !== 200) return { http_status, html: null };
  let body = message.subarray(httpEnd + 4);
  if (/^transfer-encoding:\s*chunked/im.test(head)) body = dechunk(body);
  if (/^content-encoding:\s*gzip/im.test(head)) {
    try {
      body = gunzipSync(body);
    } catch {
      return { http_status, html: null };
    }
  }
  return { http_status, html: body.toString("utf8") };
}

function indexOfBlankLine(buf, from) {
  return buf.indexOf("\r\n\r\n", from, "latin1");
}

function dechunk(buf) {
  const parts = [];
  let pos = 0;
  while (pos < buf.length) {
    const lineEnd = buf.indexOf("\r\n", pos, "latin1");
    if (lineEnd === -1) break;
    const size = parseInt(buf.subarray(pos, lineEnd).toString("latin1").split(";")[0].trim(), 16);
    if (!Number.isFinite(size) || size === 0) break;
    parts.push(buf.subarray(lineEnd + 2, lineEnd + 2 + size));
    pos = lineEnd + 2 + size + 2;
  }
  return Buffer.concat(parts);
}

// ---- Wayback --------------------------------------------------------------

// One calendar month per call keeps responses well under the CDX server's
// comfort zone (the busiest observed month is ~16k unique captures).
export async function fetchWaybackCdx(month, { fetcher = fetch } = {}) {
  const qs = new URLSearchParams({
    url: AD_PAGE_PREFIX,
    from: month,
    to: month,
    filter: "statuscode:200",
    collapse: "urlkey",
    output: "json",
    fl: "timestamp,original",
  });
  const res = await fetcher(`${WAYBACK_CDX}?${qs}`, { headers: headers() });
  if (!res.ok) throw new Error(`wayback cdx ${month} → ${res.status}`);
  const text = (await res.text()).trim();
  if (!text) return [];
  let table;
  try {
    table = JSON.parse(text);
  } catch {
    throw new Error(`wayback cdx ${month} → unparseable body`);
  }
  // First row is the column header; resolve indexes from it rather than
  // trusting our own `fl` order, so a server-side default still parses.
  const header = Array.isArray(table?.[0]) ? table[0].map(String) : [];
  const tsIdx = header.indexOf("timestamp");
  const urlIdx = header.indexOf("original");
  if (tsIdx === -1 || urlIdx === -1) return [];
  const rows = [];
  for (const entry of table.slice(1)) {
    if (!Array.isArray(entry)) continue;
    const timestamp = entry[tsIdx];
    const url = entry[urlIdx];
    const m = UUID_RE.exec(String(url || ""));
    const captured_at = cdxTimestampToIso(timestamp);
    if (!m || !captured_at) continue;
    rows.push({
      id: m[1].toLowerCase(),
      source: "wayback",
      captured_at,
      locator: { timestamp: String(timestamp), url: String(url) },
    });
  }
  return rows;
}

// `id_` returns the capture byte-for-byte, without the Wayback toolbar or
// rewritten links.
export function waybackRawUrl(locator) {
  return `${WAYBACK_WEB}/${locator.timestamp}id_/${locator.url}`;
}

export async function fetchWaybackCapture(locator, { fetcher = fetch } = {}) {
  const res = await fetcher(waybackRawUrl(locator), { headers: headers({ Accept: "text/html" }), redirect: "follow" });
  const rateLimited = res.status === 429 || res.status === 503;
  const html = res.status === 200 ? await res.text() : null;
  return { http_status: res.status, html, rateLimited };
}

// ---- helpers ----------------------------------------------------------------

// CDX timestamps are YYYYMMDDhhmmss in UTC.
export function cdxTimestampToIso(ts) {
  const s = String(ts || "");
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}
