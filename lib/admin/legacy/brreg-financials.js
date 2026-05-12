// lib/admin/legacy/brreg-financials.js
// Annual-financials ingest layer on top of /oppstart. Pulls
// årsregnskap rows from Regnskapsregisteret and persists them into
// brreg_financials (one row per orgnr × fiscal_year). No LLM in
// this pipeline — the API returns structured numeric JSON; we map
// fields directly.
//
// API: https://data.brreg.no/regnskapsregisteret/regnskap/{orgnr}
// Returns: 200 with array of årsregnskap objects, or 404 if the
// company has never filed. Empty array = company exists but no
// filings on record (e.g. recently incorporated, or under the
// regnskapsplikt threshold).
//
// Drain ordering:
//   1. AI-flagged orgnrs in brreg_companies that have NO entry in
//      brreg_financials_fetch_state (never tried).
//   2. AI-flagged orgnrs whose last attempt is older than 180 days.
//   Both in oldest-attempt-first order.

import { fetchFinancialsForOrgnr } from "./brreg-financials-client.js";

const JOB_NAME = "brreg_financials_drain";

// Default K: 20 orgnrs per tick. Each fetch is ~500-800 ms with the
// 250 ms polite pacing in the client; 20 × 800 ms ≈ 16 s of network
// per tick well under the 60 s wall budget.
const DEFAULT_K = 20;
const DEFAULT_WALL_MS = 60_000;

// Re-attempt cadence for orgnrs we've already touched. Annual filings
// only land once a year (Jul-Sep for prior calendar year), so once
// every ~6 months is plenty even accounting for late filings.
const RETRY_AFTER_DAYS = 180;

// ---- Heartbeat ---------------------------------------------------------

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

// ---- Persistence -------------------------------------------------------

async function upsertFinancials(sb, rows) {
  if (!rows.length) return 0;
  await sb(`/brreg_financials?on_conflict=orgnr,fiscal_year`, {
    service: true,
    method: "POST",
    body: rows,
    prefer: "return=minimal,resolution=merge-duplicates",
  });
  return rows.length;
}

async function upsertFetchState(sb, orgnr, status, error = null) {
  await sb(`/brreg_financials_fetch_state?on_conflict=orgnr`, {
    service: true,
    method: "POST",
    body: [
      {
        orgnr,
        last_fetch_attempt_at: new Date().toISOString(),
        last_fetch_status: status,
        last_fetch_error: error ? String(error).slice(0, 500) : null,
        attempts: 1, // overwritten by SQL trigger or merged in a follow-up if needed
      },
    ],
    prefer: "return=minimal,resolution=merge-duplicates",
  });
}

// ---- Candidate selection ----------------------------------------------

// Returns up to K orgnrs in priority order: untouched AI-flagged first,
// then stale-attempt AI-flagged. Pulls the full AI-flagged population
// and the full fetch-state in two calls and anti-joins client-side. The
// AI population is bounded by Norwegian-AI-startup count (~thousands),
// so two large reads beat the alternatives of either an unbounded
// not.in URL or a per-orgnr stored procedure.
async function selectCandidates(sb, k) {
  // Pull the full AI-flagged population. limit=50000 is well above the
  // realistic ceiling (~10k for years) and matches the pattern used by
  // /app/(site)/oppstart/page.tsx for brreg_snapshot_daily.
  const aiCompanies = await sb(
    `/brreg_companies?is_ai_relevant=is.true` +
      `&select=orgnr` +
      `&order=registrert_dato.desc.nullslast` +
      `&limit=50000`,
    { service: true },
  );
  if (!aiCompanies.length) return [];

  // Pull the full fetch-state table. One row per orgnr ever attempted —
  // bounded by aiCompanies.length, so the same magnitude.
  const tried = await sb(
    `/brreg_financials_fetch_state?select=orgnr,last_fetch_attempt_at&limit=50000`,
    { service: true },
  );
  const triedMap = new Map(tried.map((r) => [r.orgnr, r.last_fetch_attempt_at]));

  const cutoff = new Date(Date.now() - RETRY_AFTER_DAYS * 86400000);
  const untouchedOrgnrs = [];
  const staleOrgnrs = [];
  for (const c of aiCompanies) {
    const ts = triedMap.get(c.orgnr);
    if (!ts) untouchedOrgnrs.push(c.orgnr);
    else if (new Date(ts) < cutoff) staleOrgnrs.push(c.orgnr);
  }
  return [...untouchedOrgnrs, ...staleOrgnrs].slice(0, k);
}

// ---- Parser ------------------------------------------------------------

// Map one årsregnskap payload to a brreg_financials row. The
// Regnskapsregisteret JSON tree is deeply nested and field presence
// varies by filer; we use optional chaining and fall through to null
// for any missing branch. raw_jsonb keeps the whole payload so we can
// re-derive when shapes change.
//
// Fiscal year: regnskapsperiode.tilDato year. For calendar-year filers
// (the majority) this equals the calendar year of revenue. Offset
// fiscal-year filers (e.g. retailers with a Mar–Feb year) get bucketed
// by the year they closed in, which is the convention SSB uses.
export function parseFinancialsRow(orgnr, payload) {
  if (!payload || typeof payload !== "object") return null;
  const fra = payload?.regnskapsperiode?.fraDato || null;
  const til = payload?.regnskapsperiode?.tilDato || null;
  if (!til) return null;
  const fiscal_year = Number(String(til).slice(0, 4));
  if (!Number.isFinite(fiscal_year)) return null;

  const r = payload?.resultatregnskapResultat || {};
  const driftsresultat = r?.driftsresultat || {};
  const driftsinntekter = driftsresultat?.driftsinntekter || {};
  const eg = payload?.egenkapitalGjeld || {};
  const eiendeler = payload?.eiendeler || {};

  return {
    orgnr,
    fiscal_year,
    regnskapsperiode_fra: fra,
    regnskapsperiode_til: til,
    valuta: payload?.valuta || null,
    sum_driftsinntekter: toBigInt(driftsinntekter?.sumDriftsinntekter),
    driftsresultat: toBigInt(driftsresultat?.driftsresultat),
    ordinaert_resultat_for_skatt: toBigInt(r?.ordinaertResultatFoerSkattekostnad),
    aarsresultat: toBigInt(r?.aarsresultat),
    sum_eiendeler: toBigInt(eiendeler?.sumEiendeler),
    sum_egenkapital: toBigInt(eg?.egenkapital?.sumEgenkapital),
    sum_gjeld: toBigInt(eg?.gjeld?.sumGjeld),
    gjennomsnittlig_antall_ansatte: toInt(
      payload?.virksomhet?.gjennomsnittligAntallAnsatte,
    ),
    raw_jsonb: payload,
  };
}

function toBigInt(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function toInt(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

// ---- Drain orchestrator -----------------------------------------------

// drainFinancials({ sb, trigger, k, maxWallMs })
//   - k: max orgnrs drained per tick
//   - maxWallMs: per-tick budget; we stop scheduling new fetches once
//     elapsed exceeds the budget (in-flight fetches still complete)
//
// Returns { status, job_id, processed, with_filings, no_filings, errors }.
export async function drainFinancials({
  sb,
  trigger = "manual",
  k = DEFAULT_K,
  maxWallMs = DEFAULT_WALL_MS,
}) {
  const [job] = await sb(`/jobs`, {
    service: true,
    method: "POST",
    body: {
      name: JOB_NAME,
      trigger,
      metadata: { k, max_wall_ms: maxWallMs },
    },
    prefer: "return=representation",
  });

  const start = Date.now();
  let processed = 0;
  let withFilings = 0;
  let noFilings = 0;
  let errors = 0;

  try {
    const candidates = await selectCandidates(sb, k);
    if (!candidates.length) {
      await finishJob(sb, job.id, {
        status: "success",
        rows_processed: 0,
        progress_pct: 100,
        metadata: { reason: "no candidates" },
      });
      return {
        status: "success",
        job_id: job.id,
        processed: 0,
        with_filings: 0,
        no_filings: 0,
        errors: 0,
      };
    }

    for (const orgnr of candidates) {
      if (Date.now() - start > maxWallMs) break;
      processed++;
      try {
        const result = await fetchFinancialsForOrgnr(orgnr);
        // 404 ⇒ no filings on record.
        if (result.http_status === 404) {
          await upsertFetchState(sb, orgnr, "NO_FILINGS");
          noFilings++;
          continue;
        }
        if (result.http_status !== 200) {
          throw new Error(`HTTP ${result.http_status}`);
        }
        const filings = Array.isArray(result.payload) ? result.payload : [];
        if (filings.length === 0) {
          await upsertFetchState(sb, orgnr, "NO_FILINGS");
          noFilings++;
          continue;
        }
        const rows = filings
          .map((f) => parseFinancialsRow(orgnr, f))
          .filter(Boolean);
        if (rows.length === 0) {
          // Malformed payload — won't help to retry, mark NO_FILINGS so
          // we don't burn budget on it again next tick.
          await upsertFetchState(sb, orgnr, "NO_FILINGS");
          noFilings++;
          continue;
        }
        await upsertFinancials(sb, rows);
        await upsertFetchState(sb, orgnr, "OK");
        withFilings++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await upsertFetchState(sb, orgnr, "HTTP_ERROR", msg);
        errors++;
      }

      if (processed % 5 === 0) {
        await heartbeat(sb, job.id, {
          step: `processed ${processed}/${candidates.length} (with=${withFilings}, none=${noFilings}, err=${errors})`,
          pct: Math.round((processed / candidates.length) * 100),
        });
      }
    }

    await finishJob(sb, job.id, {
      status: "success",
      rows_processed: processed,
      progress_pct: 100,
      metadata: {
        processed,
        with_filings: withFilings,
        no_filings: noFilings,
        errors,
        elapsed_ms: Date.now() - start,
      },
    });

    return {
      status: "success",
      job_id: job.id,
      processed,
      with_filings: withFilings,
      no_filings: noFilings,
      errors,
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
