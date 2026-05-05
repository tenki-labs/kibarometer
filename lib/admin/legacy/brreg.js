// lib/admin/legacy/brreg.js
// Orchestration for the /oppstart pipeline. Mirrors the NAV jobs.js shape:
// each entry point creates a `jobs` row, heartbeats during work, and PATCHes
// a terminal status at the end.
//
// PR 3 lands fetchBrreg() — daily-forward ingest. Subsequent PRs add
// bootstrapBrreg() (PR 4, bulk dump), enrichRolesBrreg() (PR 5), and
// refreshBrregSnapshots() (PR 6).

import { fetchEnheterBatch } from "./brreg-client.js";
import { compileMatchers, loadActiveKeywords } from "./nav-processor.js";
import { extractFromBrregEntity } from "./brreg-processor.js";

const FETCH_JOB = "fetch_brreg_enheter";

// Upsert chunk size for /brreg_companies. PostgREST handles bulk POSTs
// fine but very large payloads slow down kong + json parse; 200 rows ≈
// ~400 KB worst-case which is comfortable.
const UPSERT_BATCH = 200;

// ---- Shared loaders ----------------------------------------------------

async function loadCategoryRows(sb) {
  // Both taxonomy versions, ordered so the processor's first-match-wins
  // walk respects sort_order.
  return sb(
    `/nace_categories?is_active=eq.true&select=slug,taxonomy_version,code_prefixes,enrich_roles,sort_order&order=sort_order.asc`,
    { service: true },
  );
}

async function loadKommuneFylkeMap(sb) {
  const rows = await sb(`/kommune_fylke?select=prefix2,fylke_label_no`, { service: true });
  const m = new Map();
  for (const r of rows) m.set(r.prefix2, r.fylke_label_no);
  return m;
}

// ---- Heartbeat (copy of jobs.js logic, kept local so brreg.js doesn't
//      import jobs.js — they're peers, not parent/child)
// -----------------------------------------------------------------------

async function heartbeat(sb, jobId, { pct, step } = {}) {
  if (!jobId) return;
  const body = { last_heartbeat: new Date().toISOString() };
  if (typeof pct === "number" && Number.isFinite(pct)) {
    body.progress_pct = Math.max(0, Math.min(100, pct));
  }
  if (typeof step === "string" && step) body.current_step = step.slice(0, 200);
  try {
    await sb(`/jobs?id=eq.${jobId}`, {
      service: true,
      method: "PATCH",
      body,
      prefer: "return=minimal",
    });
  } catch (e) {
    console.error(`heartbeat ${jobId} failed (non-fatal):`, e.message);
  }
}

async function finishJob(sb, jobId, fields) {
  if (!jobId) return;
  await sb(`/jobs?id=eq.${jobId}`, {
    service: true,
    method: "PATCH",
    body: { ...fields, finished_at: new Date().toISOString() },
    prefer: "return=minimal",
  });
}

// ---- Date helpers ------------------------------------------------------

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function yesterdayUTC() {
  return isoDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
}

// ---- Upsert helpers ----------------------------------------------------

// Upsert a chunk of brreg_companies rows. Excludes ingested_at so re-ingest
// preserves the original ingestion timestamp; explicitly sets last_seen_at
// so re-ingest bumps it. Excludes the generated column is_ai_relevant.
async function upsertCompaniesChunk(sb, chunk) {
  if (!chunk.length) return 0;
  const now = new Date().toISOString();
  const body = chunk.map((r) => ({
    orgnr: r.orgnr,
    navn: r.navn,
    organisasjonsform: r.organisasjonsform,
    registrert_dato: r.registrert_dato,
    stiftelsesdato: r.stiftelsesdato,
    slettet_dato: r.slettet_dato,
    naeringskode_1: r.naeringskode_1,
    naeringskode_2: r.naeringskode_2,
    naeringskode_3: r.naeringskode_3,
    naeringskode_taxonomy_version: r.naeringskode_taxonomy_version,
    nace_category_slug: r.nace_category_slug,
    kommunenummer: r.kommunenummer,
    postnummer: r.postnummer,
    poststed: r.poststed,
    fylke: r.fylke,
    antall_ansatte: r.antall_ansatte,
    aksjekapital: r.aksjekapital,
    aktivitet: r.aktivitet,
    konkurs: r.konkurs,
    under_avvikling: r.under_avvikling,
    has_ai_in_name: r.has_ai_in_name,
    has_ai_in_aktivitet: r.has_ai_in_aktivitet,
    matched_keywords_name: r.matched_keywords_name,
    matched_keywords_aktivitet: r.matched_keywords_aktivitet,
    last_seen_at: now,
    raw_jsonb: r.raw_jsonb,
  }));
  await sb(`/brreg_companies?on_conflict=orgnr`, {
    service: true,
    method: "POST",
    body,
    prefer: "return=minimal,resolution=merge-duplicates",
  });
  return body.length;
}

// Enqueue role-fetches for orgnrs in enrich_roles=true categories that
// don't already have a queue row. Idempotent on orgnr.
async function enqueueRoleFetches(sb, orgnrs) {
  if (!orgnrs.length) return 0;
  const body = orgnrs.map((orgnr) => ({
    orgnr,
    status: "pending",
  }));
  await sb(`/brreg_url_queue?on_conflict=orgnr`, {
    service: true,
    method: "POST",
    body,
    // ignore-duplicates so an already-queued or already-fetched row stays
    // as-is (we don't want to reset attempts/last_error on re-ingest).
    prefer: "return=minimal,resolution=ignore-duplicates",
  });
  return body.length;
}

// ---- Daily incremental ingest (PR 3) -----------------------------------

// fetchBrreg({ sb, trigger, fromDate, toDate, maxPages, maxWallMs })
//   - fromDate / toDate (ISO YYYY-MM-DD): defaults to yesterday/yesterday
//   - maxPages / maxWallMs: budget; fetchEnheterBatch enforces both
//
// Returns { status, job_id, fromDate, toDate, fetched, upserted, enqueued }.
export async function fetchBrreg({
  sb,
  trigger = "manual",
  fromDate = null,
  toDate = null,
  maxPages = 50,
  maxWallMs = 90_000,
} = {}) {
  const yday = yesterdayUTC();
  const from = fromDate || yday;
  const to = toDate || yday;

  const [job] = await sb(`/jobs`, {
    service: true,
    method: "POST",
    body: {
      name: FETCH_JOB,
      trigger,
      metadata: { from_date: from, to_date: to },
    },
    prefer: "return=representation",
  });

  await heartbeat(sb, job.id, { step: `loading matchers + categories` });

  try {
    // One-shot loaders.
    const [keywords, categoryRows, kommuneFylkeMap] = await Promise.all([
      loadActiveKeywords(sb),
      loadCategoryRows(sb),
      loadKommuneFylkeMap(sb),
    ]);
    const matchers = compileMatchers(keywords);
    const enrichSlugs = new Set(
      categoryRows.filter((c) => c.enrich_roles).map((c) => c.slug),
    );
    const ctx = { matchers, categoryRows, kommuneFylkeMap };

    let fetched = 0;
    let upserted = 0;
    let enqueueCandidates = [];
    let pagesFetched = 0;

    const result = await fetchEnheterBatch({
      fromDate: from,
      toDate: to,
      size: 1000,
      maxPages,
      maxWallMs,
      onPage: async (enheter, pageIdx, pageEnvelope) => {
        pagesFetched = pageIdx + 1;
        fetched += enheter.length;
        const rows = enheter
          .map((e) => extractFromBrregEntity(e, ctx))
          .filter(Boolean);
        // Upsert in chunks
        for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
          const chunk = rows.slice(i, i + UPSERT_BATCH);
          upserted += await upsertCompaniesChunk(sb, chunk);
        }
        // Collect orgnrs that should get role-enriched
        for (const r of rows) {
          if (enrichSlugs.has(r.nace_category_slug)) {
            enqueueCandidates.push(r.orgnr);
          }
        }
        const totalPages = pageEnvelope?.totalPages ?? null;
        const pct =
          totalPages && totalPages > 0
            ? Math.round((pagesFetched / totalPages) * 100)
            : null;
        await heartbeat(sb, job.id, {
          pct: pct ?? undefined,
          step: `fetched page ${pagesFetched}/${totalPages ?? "?"} — ${fetched} entities, ${upserted} upserted`,
        });
      },
    });

    // Enqueue role-fetches for enrich_roles=true categories. Single batch
    // call; PostgREST handles ~thousands of rows in one POST comfortably.
    let enqueued = 0;
    if (enqueueCandidates.length) {
      enqueued = await enqueueRoleFetches(sb, enqueueCandidates);
    }

    await finishJob(sb, job.id, {
      status: "success",
      rows_processed: upserted,
      progress_pct: 100,
      metadata: {
        from_date: from,
        to_date: to,
        fetched,
        upserted,
        enqueued,
        pages_fetched: result.pagesFetched,
        completed: result.completed,
        total_elements: result.totalElements,
      },
    });

    return {
      status: "success",
      job_id: job.id,
      fromDate: from,
      toDate: to,
      fetched,
      upserted,
      enqueued,
      pages_fetched: result.pagesFetched,
      completed: result.completed,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finishJob(sb, job.id, {
      status: "failed",
      error: msg.slice(0, 1000),
    });
    throw err;
  }
}
