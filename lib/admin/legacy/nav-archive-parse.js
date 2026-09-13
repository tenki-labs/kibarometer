// lib/admin/legacy/nav-archive-parse.js
// Parse an arbeidsplassen.nav.no ad page (live, Common Crawl WARC body, or
// Wayback `id_` raw capture) into the detail-tier fields nav_postings needs.
// Zero deps, Node 22 builtins only.
//
// Two independent extractions, so a partial page still yields something:
//   1. description — inner HTML of the first `.job-posting-text` block. The
//      page renders the ad body first and the employer blurb ("Om bedriften")
//      second, both with that class; we want the first only, matching what
//      NAV's feed API returns in `ad_content.description`.
//   2. metadata — the page is a Next.js RSC render, and the server-side
//      `adData` object is serialised into `self.__next_f.push([1,"..."])`
//      chunks. We decode the chunk string (it is JSON.stringify output),
//      find `"adData":{`, brace-walk to the matching `}` and JSON.parse it.
//      Field names drifted between the 2024 and 2026 site versions (e.g.
//      `applicationUrl` moved under `application`), so every read is
//      defensive.
//
// Returns null when the page is not an ad page (404 shell, search page).

const BLOCK_CLASS = "job-posting-text";

export function parseArbeidsplassenAd(html) {
  const text = typeof html === "string" ? html : "";
  if (!text) return null;

  const description = extractFirstBlock(text, BLOCK_CLASS);
  const ad = extractAdData(text);
  if (!description && !ad) return null;

  const loc = firstObject(ad?.locationList);
  const applyUrl = str(ad?.application?.applicationUrl) || str(ad?.applicationUrl) || str(ad?.sourceUrl) || null;

  return {
    id: str(ad?.id) || str(ad?.uuid) || null,
    status: str(ad?.status) || null,
    title: str(ad?.title) || extractH1(text) || null,
    source: str(ad?.source) || null,
    published: dateStr(ad?.published),
    expires: dateStr(ad?.expires),
    updated: dateStr(ad?.updated),
    jobTitle: str(ad?.jobTitle) || null,
    employerName: str(ad?.employer?.name) || null,
    county: str(loc?.county) || null,
    municipal: str(loc?.municipal) || null,
    applyUrl,
    description: description || null,
  };
}

// ---- description block --------------------------------------------------

// Find the first element whose class attribute contains `className` and
// return its inner HTML. Tracks nesting of the element's own tag name so
// nested <div>s inside the block don't terminate it early.
export function extractFirstBlock(html, className) {
  const openRe = new RegExp(`<([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>`);
  const open = openRe.exec(html);
  if (!open) return null;
  const tag = open[1].toLowerCase();
  const start = open.index + open[0].length;
  const tagRe = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  tagRe.lastIndex = start;
  let depth = 1;
  let m;
  while ((m = tagRe.exec(html))) {
    if (m[1] === "/") depth -= 1;
    else if (!m[0].endsWith("/>")) depth += 1;
    if (depth === 0) {
      return html.slice(start, m.index).trim() || null;
    }
  }
  return null;
}

function extractH1(html) {
  const m = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (!m) return null;
  return decodeEntities(m[1].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim() || null;
}

// ---- RSC metadata ---------------------------------------------------------

const PUSH_RE = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;

export function extractAdData(html) {
  PUSH_RE.lastIndex = 0;
  let m;
  while ((m = PUSH_RE.exec(html))) {
    if (!m[1].includes('adData')) continue;
    let decoded;
    try {
      decoded = JSON.parse(`"${m[1]}"`);
    } catch {
      continue;
    }
    let from = 0;
    for (;;) {
      const at = decoded.indexOf('"adData":{', from);
      if (at === -1) break;
      const objStart = at + '"adData":'.length;
      const raw = sliceJsonObject(decoded, objStart);
      if (raw) {
        try {
          const obj = JSON.parse(raw);
          if (obj && typeof obj === "object" && (obj.id || obj.uuid || obj.title)) return obj;
        } catch {
          // fall through to the next occurrence
        }
      }
      from = objStart + 1;
    }
  }
  return null;
}

// Return the substring of `s` that is the JSON object starting at `start`
// (which must point at `{`), honouring string literals and escapes.
export function sliceJsonObject(s, start) {
  if (s[start] !== "{") return null;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < s.length; i += 1) {
    const ch = s[i];
    if (inStr) {
      if (ch === "\\") i += 1;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

// ---- helpers ----------------------------------------------------------------

function str(v) {
  return typeof v === "string" && v.trim() ? v.trim() : "";
}

// Newer site versions serialise Date objects through React Server
// Components, which prefixes the ISO string with "$D" ("$D2024-10-23T22:00:00.000Z").
function dateStr(v) {
  const s = str(v);
  if (!s) return null;
  return s.startsWith("$D") ? s.slice(2) : s;
}

function firstObject(list) {
  return Array.isArray(list) && list[0] && typeof list[0] === "object" ? list[0] : null;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " };

function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+|#39);/g, (whole, name) => {
    if (name in ENTITIES) return ENTITIES[name];
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return whole;
  });
}
