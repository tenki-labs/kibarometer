// lib/admin/legacy/brreg.js
// Orchestration for the /oppstart pipeline. Mirrors the NAV jobs.js shape:
// each entry point creates a `jobs` row, heartbeats during work, and PATCHes
// a terminal status at the end.
//
// PR 3 lands fetchBrreg() — daily-forward ingest.
// PR 4 lands bootstrapBrreg() — one-shot bulk-dump streamer for the
//   historical baseline (default floor 2018-01-01).
// Subsequent PRs add enrichRolesBrreg() (PR 5) and
//   refreshBrregSnapshots() (PR 6).

import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";

import { fetchEnheterBatch } from "./brreg-client.js";
import { compileMatchers, loadActiveKeywords } from "./nav-processor.js";
import { extractFromBrregEntity } from "./brreg-processor.js";

const FETCH_JOB = "fetch_brreg_enheter";
const BOOTSTRAP_JOB = "bootstrap_brreg";

// brreg's daily JSON dump endpoint. Default Accept yields gzipped JSON
// (one big array). ~200 MB compressed; refreshed once per 24h around 04:30
// CEST. Uncompressed ≈ 1.5–2 GB so the streamer never buffers the whole
// thing — it parses one entity at a time off a gunzip stream.
const BULK_DUMP_URL = "https://data.brreg.no/enhetsregisteret/api/enheter/lastned";

// Same NLOD attribution string as brreg-client.js; duplicated to keep
// brreg.js orchestrator-only (no internal imports cycling back through
// the client).
const BOOTSTRAP_USER_AGENT =
  "kibarometerbot/1.0 (+https://kibarometer.no/about/bot; nlod-attribution=brreg)";

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
}) {
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

// ---- Streaming JSON-array element parser (PR 4) ------------------------

// Yields one parsed top-level array element at a time from a byte stream.
// Used to walk brreg's bulk-dump JSON without loading the ~1.5 GB
// decompressed payload into memory. Tracks bracket depth + string-escape
// state to find object boundaries without a full parse.
//
// Constraints:
//   - The input must be a JSON array of objects (`[{...},{...},...]`).
//     brreg's bulk dump matches this shape verbatim (verified live against
//     /enhetsregisteret/api/enheter/lastned).
//   - Whitespace + newlines between elements are tolerated.
//   - String escapes (\\ and \") are tracked correctly so braces inside
//     quoted strings don't fool the depth counter.
//   - Memory bound: the buffer holds at most one in-flight element + the
//     trailing tail of the current chunk. Since brreg entities top out
//     around 5 KB, the buffer never grows beyond ~10 KB.
//
// Exported for unit testing (no PR-3 callers).
export async function* parseJsonArrayObjects(byteIterable) {
  const decoder = new TextDecoder();
  let buf = "";
  // pos persists across chunks — `i` would reset to 0 on each new chunk
  // and double-count the in-string / depth state for bytes we already
  // classified.
  let pos = 0;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let startedArray = false;
  let objStart = -1;

  for await (const chunk of byteIterable) {
    buf += decoder.decode(chunk, { stream: true });

    while (pos < buf.length) {
      const ch = buf[pos];

      if (!startedArray) {
        if (ch === "[") startedArray = true;
        pos++;
        continue;
      }

      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        pos++;
        continue;
      }

      if (ch === '"') {
        inString = true;
        pos++;
        continue;
      }

      if (ch === "{") {
        if (depth === 0) objStart = pos;
        depth++;
        pos++;
        continue;
      }

      if (ch === "}") {
        depth--;
        if (depth === 0 && objStart >= 0) {
          const objStr = buf.slice(objStart, pos + 1);
          let obj;
          try {
            obj = JSON.parse(objStr);
          } catch (e) {
            const head = objStr.slice(0, 200);
            throw new Error(`parseJsonArrayObjects: JSON.parse failed: ${e.message} (head: ${head})`);
          }
          yield obj;
          objStart = -1;
        }
        pos++;
        continue;
      }

      // Commas, ']', whitespace at depth 0: just advance.
      pos++;
    }

    // Compact: drop already-processed bytes that we'll never need to
    // re-examine. If mid-element, keep from objStart onward; else drop
    // everything up to the current scan position.
    const drop = objStart >= 0 ? objStart : pos;
    if (drop > 0) {
      buf = buf.slice(drop);
      pos -= drop;
      if (objStart >= 0) objStart -= drop;
    }
  }
}

// ---- Bootstrap (bulk dump, PR 4) ---------------------------------------

// bootstrapBrreg({ sb, trigger, floorDate })
//   - floorDate (ISO YYYY-MM-DD): only entities with
//     registreringsdatoEnhetsregisteret >= floorDate are persisted.
//     Defaults to app_settings.brreg_bootstrap_floor_date (default
//     '2018-01-01' from the 0030 migration).
//
// Manual-trigger only (no cron). Streams the gzipped JSON dump,
// gunzips, parses one entity at a time, batches upserts. Heartbeats
// every 5 s with running totals so the operator can watch progress.
// Re-runnable: idempotent on orgnr; last_seen_at bumps on conflict.
//
// Returns { status, job_id, floorDate, totalSeen, totalKept, totalUpserted,
// totalEnqueued }.
export async function bootstrapBrreg({
  sb,
  trigger = "manual",
  floorDate = null,
}) {
  const [job] = await sb(`/jobs`, {
    service: true,
    method: "POST",
    body: {
      name: BOOTSTRAP_JOB,
      trigger,
      metadata: { floor_date: floorDate || "(from app_settings)" },
    },
    prefer: "return=representation",
  });

  try {
    // Resolve floor date.
    let floor = floorDate;
    if (!floor) {
      const settings = await sb(
        `/app_settings?id=eq.1&select=brreg_bootstrap_floor_date`,
        { service: true },
      );
      floor = settings?.[0]?.brreg_bootstrap_floor_date || "2024-01-01";
    }

    await heartbeat(sb, job.id, { step: `loading matchers + categories`, pct: 0 });

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

    await heartbeat(sb, job.id, {
      step: `downloading bulk dump (filter registrert_dato >= ${floor})`,
      pct: 1,
    });

    const res = await fetch(BULK_DUMP_URL, {
      headers: {
        Accept: "application/gzip",
        "User-Agent": BOOTSTRAP_USER_AGENT,
      },
    });
    if (!res.ok) throw new Error(`bulk dump HTTP ${res.status}`);
    if (!res.body) throw new Error(`bulk dump: empty body`);

    // Pipe Web ReadableStream → Node Readable → gunzip → JSON object stream.
    const nodeIn = Readable.fromWeb(res.body);
    const gunzip = createGunzip();
    nodeIn.pipe(gunzip);
    // If the source errors mid-stream, surface it on gunzip so the
    // for-await-of below rejects (instead of hanging).
    nodeIn.on("error", (e) => gunzip.destroy(e));

    let totalSeen = 0;
    let totalKept = 0;
    let totalUpserted = 0;
    let totalEnqueued = 0;
    let pendingChunk = [];
    let pendingEnqueue = [];
    let lastHeartbeatAt = Date.now();

    for await (const entity of parseJsonArrayObjects(gunzip)) {
      totalSeen++;
      const regDate = entity?.registreringsdatoEnhetsregisteret;
      if (!regDate || regDate < floor) continue;
      const row = extractFromBrregEntity(entity, ctx);
      if (!row) continue;
      pendingChunk.push(row);
      totalKept++;
      if (enrichSlugs.has(row.nace_category_slug)) {
        pendingEnqueue.push(row.orgnr);
      }

      if (pendingChunk.length >= UPSERT_BATCH) {
        totalUpserted += await upsertCompaniesChunk(sb, pendingChunk);
        pendingChunk = [];
      }

      // Heartbeat + flush enqueue buffer at most once every 5 s.
      if (Date.now() - lastHeartbeatAt > 5000) {
        await heartbeat(sb, job.id, {
          step: `seen ${totalSeen}, kept ${totalKept}, upserted ${totalUpserted}, enqueued ${totalEnqueued}`,
        });
        lastHeartbeatAt = Date.now();
        // Flush enqueue in 1k-row batches; PostgREST handles thousands at a time.
        while (pendingEnqueue.length >= 1000) {
          totalEnqueued += await enqueueRoleFetches(
            sb,
            pendingEnqueue.splice(0, 1000),
          );
        }
      }
    }

    // Final flush.
    if (pendingChunk.length) {
      totalUpserted += await upsertCompaniesChunk(sb, pendingChunk);
      pendingChunk = [];
    }
    while (pendingEnqueue.length) {
      totalEnqueued += await enqueueRoleFetches(
        sb,
        pendingEnqueue.splice(0, 1000),
      );
    }

    await finishJob(sb, job.id, {
      status: "success",
      rows_processed: totalUpserted,
      progress_pct: 100,
      metadata: {
        floor_date: floor,
        total_seen: totalSeen,
        total_kept: totalKept,
        total_upserted: totalUpserted,
        total_enqueued: totalEnqueued,
      },
    });

    return {
      status: "success",
      job_id: job.id,
      floorDate: floor,
      totalSeen,
      totalKept,
      totalUpserted,
      totalEnqueued,
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
