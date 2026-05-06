// scripts/nav/processor.js
// Phase C: pure-function module that turns NAV feed pages into nav_postings
// rows, plus the keyword-tagging engine. Zero deps, Node 22 builtins only.
//
// Two callers:
//   1. processPayload({ sb, navRawRow, matchers }) — runs after each
//      fetch/backfill batch writes a nav_raw row. Upserts SUMMARY-tier rows
//      (title, employer, municipal, posted_at, status, source_url) and tags
//      against title only.
//   2. enrichFromDetail(detailJson) — used by the enrichment job to populate
//      DETAIL-tier columns (description, occupation, etc.) for ACTIVE postings.
//
// Tagging is Unicode-aware so Norwegian word boundaries (æ ø å) work. The
// matcher is built once per batch from the active keyword list — never call
// compileMatchers() inside the per-item loop.

const FEEDENTRY_BASE = "https://pam-stilling-feed.nav.no";

// ---- Matchers ----------------------------------------------------------

// Build a stable, batch-shared matcher list from a keyword row set. Each
// matcher pre-lowercases its term and compiles the right test fn:
//   substring → text.includes(term)
//   word      → /(?<![\p{L}\p{N}_])term(?![\p{L}\p{N}_])/u
// Word-boundary uses Unicode lookarounds rather than \b (which is ASCII-only,
// so it would split "AI-ingeniør" wrong on the å).
export function compileMatchers(keywords) {
  return keywords.map((k) => {
    const term = String(k.term || "").toLowerCase();
    if (!term) return null;
    if (k.match_type === "substring") {
      return { term: k.term, test: (text) => text.includes(term) };
    }
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "u");
    return { term: k.term, test: (text) => re.test(text) };
  }).filter(Boolean);
}

// Apply matchers to a haystack. Returns canonical {is_ai, matched_keywords}.
// Callers should concatenate whatever text they have (title, then description,
// occupation if present) before passing in — the matcher doesn't care.
export function applyTags(haystack, matchers) {
  const text = String(haystack || "").toLowerCase();
  if (!text) return { is_ai: false, matched_keywords: [] };
  const matched = [];
  for (const m of matchers) {
    if (m.test(text)) matched.push(m.term);
  }
  return { is_ai: matched.length > 0, matched_keywords: matched };
}

// ---- Summary extraction (from feed item) -------------------------------

// Map one feed item → a nav_postings SUMMARY-tier row. No detail fields.
// posted_at uses date_modified (= sistEndret) as a proxy. For old INACTIVE
// postings this is NAV's bulk-import timestamp; that's a known limitation
// addressed by the enrichment job populating real `published` dates.
export function extractFromFeedItem(item, navRawId) {
  const fe = item?._feed_entry || {};
  const url = item?.url ? `${FEEDENTRY_BASE}${item.url}` : null;
  return {
    id: item.id,
    nav_raw_id: navRawId,
    title: item.title || fe.title || null,
    employer_name: fe.businessName || null,
    location_municipality: fe.municipal || null,
    status: fe.status || null,
    source_url: url,
    posted_at: item.date_modified || fe.sistEndret || null,
  };
}

// ---- Detail extraction (from feedentry GET) ----------------------------

// Map one /api/v1/feedentry/{uuid} detail response → DETAIL-tier columns.
// All fields are nullable — INACTIVE postings return only {uuid, status,
// sistEndret} and we don't want to clobber summary fields with nulls in that
// case. Caller is responsible for skipping enrichment when status='INACTIVE'.
export function enrichFromDetail(detail) {
  const j = detail?.json || {};
  const wl = Array.isArray(j.workLocations) && j.workLocations[0] ? j.workLocations[0] : {};
  const oc = Array.isArray(j.occupationCategories) && j.occupationCategories[0]
    ? j.occupationCategories[0] : {};
  return {
    description: j.description || null,
    occupation: j.jobtitle || null,
    category: oc.level1 || null,
    location_county: wl.county || null,
    location_country: wl.country || "NO",
    expires_at: j.expires || null,
    apply_url: j.applicationUrl || j.sourceurl || null,
    // Override posted_at if detail gives a real published date — much more
    // accurate than the summary's sistEndret proxy.
    posted_at: j.published || undefined,
    status: detail?.status || null,
  };
}

// ---- Bulk upsert: feed page → nav_postings ----------------------------

// Process one nav_raw row's feed page: extract every item, tag against title,
// upsert all rows in chunks. Returns the number of rows upserted.
//
// Idempotent: PostgREST upsert with merge-duplicates only writes the columns
// in the body, so re-processing the same page (e.g. backfill orphan/resume
// duplication) doesn't clobber detail-tier columns the enrichment job has
// since populated.
export async function processPayload({ sb, navRawRow, matchers }) {
  const items = Array.isArray(navRawRow?.payload?.items) ? navRawRow.payload.items : [];
  if (items.length === 0) return 0;

  const rows = items
    .map((item) => {
      if (!item?.id) return null;
      const base = extractFromFeedItem(item, navRawRow.id);
      const tags = applyTags(base.title, matchers);
      return { ...base, is_ai: tags.is_ai, matched_keywords: tags.matched_keywords };
    })
    .filter(Boolean);

  // NAV's feed occasionally returns the same item id twice within a single
  // page (typically when an item was modified during the snapshot window).
  // Postgres rejects a batch INSERT ... ON CONFLICT DO UPDATE that targets
  // the same row twice ("cannot affect row a second time"), so we dedupe
  // by id before chunking. Keep the LAST occurrence — NAV emits items in
  // event order, so later = more recent state.
  const byId = new Map();
  for (const row of rows) byId.set(row.id, row);
  const uniqueRows = [...byId.values()];

  const CHUNK = 500;
  for (let i = 0; i < uniqueRows.length; i += CHUNK) {
    await sb("/nav_postings?on_conflict=id", {
      service: true,
      method: "POST",
      body: uniqueRows.slice(i, i + CHUNK),
      prefer: "resolution=merge-duplicates,return=minimal",
    });
  }
  return uniqueRows.length;
}

// ---- Helper: load active keywords once per batch -----------------------

export async function loadActiveKeywords(sb) {
  // status=in.(canonical,trial) so trial keywords (PR 6) tag in nav_postings
  // for observability. Public is_ai stats filter to canonical at snapshot time.
  // domain filter excludes media-only keywords (added in 0029_media.sql with
  // domain='media') from the NAV tagger — without this, a keyword someone
  // adds for media coverage would silently start matching against job
  // postings too. See lib/admin/legacy/media-processor.js for the parallel
  // loader that filters to (media,any).
  return sb(
    "/keywords?status=in.(canonical,trial)&domain=in.(jobs,any)&select=term,language,category,match_type",
    { service: true }
  );
}
