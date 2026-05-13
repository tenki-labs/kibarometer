// lib/admin/legacy/storting.js
// Orchestration for the Stortinget half of the /offentlig pillar. Three
// entry points modelled on brreg.js:
//   fetchStorting()       — daily forward poll of the active session.
//   backfillStorting()    — one-shot walk of historical sessions back to
//                           2019-2020 (covers calendar 2020 — Stortinget
//                           year boundary is October, so this session is
//                           the one that contains Jan-Sep 2020 data).
//   retagStorting()       — re-runs the keyword matcher against every row
//                           and refreshes is_ai_relevant. Weekly Sunday cron.
//
// Each entry point creates a `jobs` row, heartbeats during work, and PATCHes
// a terminal status at the end (same shape as the NAV / BRREG jobs pipelines).
//
// LLM Tier 1/2 ticks live in lib/admin/llm-storting-tierN.ts (B2 work, not
// touched here). This module is forward-only for the LLM columns.

import { compileMatchers } from "./nav-processor.js";
import {
  fetchSakerForSession,
  fetchVedtakForSession,
  currentSessionId,
  enumerateSessions,
} from "./storting-client.js";
import {
  loadActiveOffentligKeywords,
  buildSakRow,
  buildVedtakRow,
} from "./storting-processor.js";

const FETCH_JOB = "fetch_storting_session";
const BACKFILL_JOB = "backfill_storting";
const RETAG_JOB = "reprocess_storting_keywords";

// PostgREST handles bulk POSTs of a few hundred rows comfortably; large
// payloads slow down kong + json parse. 200 mirrors brreg.
const UPSERT_BATCH = 200;

// Floor session for backfill. Stortinget sessions span October → September,
// so the 2019-2020 session is the one that contains all of calendar 2020
// (Jan-Sep 2020 in 2019-2020; Oct-Dec 2020 in 2020-2021). The /offentlig
// dashboard frames itself as "since 2020", so this is the natural floor.
// Earlier sessions stay in the table if a prior backfill ran with the old
// "2018-2019" floor — this constant only affects new backfill runs.
const DEFAULT_FROM_SESSION = "2019-2020";

// ---- Heartbeat / job lifecycle (kept local; peers, not parent/child) ----

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
    console.error(`storting heartbeat ${jobId} failed (non-fatal):`, e.message);
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

// ---- Upserts ------------------------------------------------------------

// Bulk-upsert a chunk of storting_saker rows. Excludes the generated column
// is_ai_relevant. retagged_at + tier* columns are intentionally NOT set
// here — daily ingest's job is to insert/refresh the upstream columns and
// keyword tags; LLM tiers and the retag worker each own their own writes.
async function upsertSakerChunk(sb, chunk, ingestMode) {
  if (!chunk.length) return 0;
  const now = new Date().toISOString();
  const body = chunk.map((r) => ({
    sak_id: r.sak_id,
    tittel: r.tittel,
    korttittel: r.korttittel,
    henvisning: r.henvisning,
    type_kode: r.type_kode,
    status_kode: r.status_kode,
    dokumentgruppe_kode: r.dokumentgruppe_kode,
    innstilling_id: r.innstilling_id,
    innstilling_kode: r.innstilling_kode,
    sak_fremmet_id: r.sak_fremmet_id,
    sesjon_id: r.sesjon_id,
    behandlet_sesjon_id: r.behandlet_sesjon_id,
    sist_oppdatert_dato: r.sist_oppdatert_dato,
    komite_id: r.komite_id,
    komite_navn: r.komite_navn,
    forslagstiller_liste: r.forslagstiller_liste,
    emne_liste: r.emne_liste,
    saksordfoerer_liste: r.saksordfoerer_liste,
    has_ai_in_title: r.has_ai_in_title,
    has_ai_in_emner: r.has_ai_in_emner,
    matched_keywords_title: r.matched_keywords_title,
    matched_keywords_emner: r.matched_keywords_emner,
    last_seen_at: now,
    raw_jsonb: r.raw_jsonb,
    ingest_mode: ingestMode,
  }));
  await sb(`/storting_saker?on_conflict=sak_id`, {
    service: true,
    method: "POST",
    body,
    prefer: "return=minimal,resolution=merge-duplicates",
  });
  return body.length;
}

async function upsertVedtakChunk(sb, chunk, ingestMode) {
  if (!chunk.length) return 0;
  const now = new Date().toISOString();
  const body = chunk.map((r) => ({
    vedtak_id: r.vedtak_id,
    sak_id: r.sak_id,
    sesjon_id: r.sesjon_id,
    nummer: r.nummer,
    dato_tid: r.dato_tid,
    tittel: r.tittel,
    tekst: r.tekst,
    type_id: r.type_id,
    type_navn: r.type_navn,
    sak_lenke_url: r.sak_lenke_url,
    vedtak_lenke_url: r.vedtak_lenke_url,
    has_ai_in_text: r.has_ai_in_text,
    matched_keywords: r.matched_keywords,
    last_seen_at: now,
    raw_jsonb: r.raw_jsonb,
    ingest_mode: ingestMode,
  }));
  // FK constraint on vedtak.sak_id → saker.sak_id means saker must land
  // first. Daily/backfill orchestration writes saker before vedtak per
  // session for this reason.
  await sb(`/storting_vedtak?on_conflict=vedtak_id`, {
    service: true,
    method: "POST",
    body,
    prefer: "return=minimal,resolution=merge-duplicates",
  });
  return body.length;
}

async function chunkedUpsertSaker(sb, rows, ingestMode) {
  let n = 0;
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    n += await upsertSakerChunk(sb, rows.slice(i, i + UPSERT_BATCH), ingestMode);
  }
  return n;
}

async function chunkedUpsertVedtak(sb, rows, ingestMode) {
  let n = 0;
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    n += await upsertVedtakChunk(sb, rows.slice(i, i + UPSERT_BATCH), ingestMode);
  }
  return n;
}

// Vedtak whose sak_id references a sak NOT in storting_saker would be
// rejected by the FK. This filter drops orphan vedtak so a transient
// upstream inconsistency doesn't break the whole upsert. The orphan
// count is reported back so an operator can investigate via the jobs
// row when it spikes.
async function filterVedtakWithKnownSak(sb, vedtakRows) {
  if (vedtakRows.length === 0) return { kept: [], dropped: 0 };
  const ids = Array.from(new Set(vedtakRows.map((v) => v.sak_id).filter(Boolean)));
  if (ids.length === 0) return { kept: [], dropped: vedtakRows.length };

  // Chunk the IN clause so the URL stays under Kong's ~8KB default limit.
  // 500 bigint ids × ~10 chars each ≈ 5KB per query — safe.
  const IN_CHUNK = 500;
  const knownSet = new Set();
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const slice = ids.slice(i, i + IN_CHUNK);
    const rows = await sb(
      `/storting_saker?select=sak_id&sak_id=in.(${slice.join(",")})`,
      { service: true },
    );
    for (const r of rows) knownSet.add(Number(r.sak_id));
  }

  const kept = [];
  let dropped = 0;
  for (const v of vedtakRows) {
    if (v.sak_id && knownSet.has(Number(v.sak_id))) {
      kept.push(v);
    } else {
      dropped += 1;
    }
  }
  return { kept, dropped };
}

// ---- Daily forward fetch ------------------------------------------------

// Fetch one session's saker + vedtak. Idempotent — re-fetches the entire
// session and merge-upserts. Default session is the current parliamentary
// year (October → September boundary). Operators can override via
// ?sessionId=YYYY-YYYY on the cron route for ad-hoc re-ingest.
export async function fetchStorting({
  sb,
  trigger = "manual",
  sessionId = null,
  ingestMode = "live",
}) {
  const session = sessionId || currentSessionId();

  const [job] = await sb(`/jobs`, {
    service: true,
    method: "POST",
    body: {
      name: FETCH_JOB,
      trigger,
      metadata: { sesjon_id: session, ingest_mode: ingestMode },
    },
    prefer: "return=representation",
  });

  try {
    await heartbeat(sb, job.id, { step: `loading matchers (session ${session})` });

    const keywords = await loadActiveOffentligKeywords(sb);
    const matchers = compileMatchers(keywords);
    const ctx = { matchers, sesjon_id: session };

    await heartbeat(sb, job.id, { step: `fetching saker for ${session}`, pct: 10 });
    const { saker } = await fetchSakerForSession(session);
    const sakerRows = saker.map((s) => buildSakRow(s, ctx)).filter(Boolean);

    await heartbeat(sb, job.id, {
      step: `upserting ${sakerRows.length} saker`,
      pct: 30,
    });
    const upsertedSaker = await chunkedUpsertSaker(sb, sakerRows, ingestMode);

    await heartbeat(sb, job.id, { step: `fetching vedtak for ${session}`, pct: 60 });
    const { vedtak } = await fetchVedtakForSession(session);
    const vedtakRows = vedtak.map((v) => buildVedtakRow(v, ctx)).filter(Boolean);

    const { kept: vedtakKept, dropped: vedtakOrphans } =
      await filterVedtakWithKnownSak(sb, vedtakRows);

    await heartbeat(sb, job.id, {
      step: `upserting ${vedtakKept.length} vedtak (${vedtakOrphans} orphans dropped)`,
      pct: 80,
    });
    const upsertedVedtak = await chunkedUpsertVedtak(sb, vedtakKept, ingestMode);

    const aiSaker = sakerRows.filter((r) => r.has_ai_in_title || r.has_ai_in_emner).length;
    const aiVedtak = vedtakKept.filter((r) => r.has_ai_in_text).length;

    await finishJob(sb, job.id, {
      status: "success",
      rows_processed: upsertedSaker + upsertedVedtak,
      progress_pct: 100,
      metadata: {
        sesjon_id: session,
        ingest_mode: ingestMode,
        saker_fetched: saker.length,
        saker_upserted: upsertedSaker,
        saker_ai_flagged: aiSaker,
        vedtak_fetched: vedtak.length,
        vedtak_upserted: upsertedVedtak,
        vedtak_orphans_dropped: vedtakOrphans,
        vedtak_ai_flagged: aiVedtak,
      },
    });

    return {
      status: "success",
      job_id: job.id,
      sesjon_id: session,
      saker_upserted: upsertedSaker,
      saker_ai_flagged: aiSaker,
      vedtak_upserted: upsertedVedtak,
      vedtak_ai_flagged: aiVedtak,
      vedtak_orphans_dropped: vedtakOrphans,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finishJob(sb, job.id, { status: "failed", error: msg.slice(0, 1000) });
    throw err;
  }
}

// ---- Historical backfill ------------------------------------------------

// Walk sessions from `fromSession` back to `toSession` (default 2019-2020,
// the data floor). Reverse-chronological order so the keyword catalog
// grown by Tier 1 on more recent sessions benefits older runs (Tier 1 is
// forward-only on live ingest; for backfill rows the next Sunday retag
// picks up newly-grown catalog terms).
//
// Each session is treated as an independent transaction. Failure on one
// session is logged but does not halt the rest — the orchestrator's job
// metadata records per-session outcomes so the operator can re-run
// failures piecemeal from /admin/offentlig (B2 admin UI).
export async function backfillStorting({
  sb,
  trigger = "manual",
  fromSession = null,
  toSession = DEFAULT_FROM_SESSION,
}) {
  const start = fromSession || currentSessionId();
  const sessions = enumerateSessions(start, toSession);

  const [job] = await sb(`/jobs`, {
    service: true,
    method: "POST",
    body: {
      name: BACKFILL_JOB,
      trigger,
      metadata: { from_session: start, to_session: toSession, session_count: sessions.length },
    },
    prefer: "return=representation",
  });

  try {
    const perSession = [];
    let totalSaker = 0;
    let totalVedtak = 0;
    let totalAiSaker = 0;
    let totalAiVedtak = 0;

    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i];
      const pct = Math.round(((i + 0.5) / sessions.length) * 100);
      await heartbeat(sb, job.id, { step: `backfilling session ${s}`, pct });
      try {
        const r = await fetchStorting({
          sb,
          trigger,
          sessionId: s,
          ingestMode: "backfill",
        });
        totalSaker += r.saker_upserted;
        totalVedtak += r.vedtak_upserted;
        totalAiSaker += r.saker_ai_flagged;
        totalAiVedtak += r.vedtak_ai_flagged;
        perSession.push({ sesjon_id: s, status: "success", ...r });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        perSession.push({ sesjon_id: s, status: "failed", error: msg.slice(0, 200) });
      }
    }

    await finishJob(sb, job.id, {
      status: "success",
      rows_processed: totalSaker + totalVedtak,
      progress_pct: 100,
      metadata: {
        from_session: start,
        to_session: toSession,
        session_count: sessions.length,
        saker_upserted: totalSaker,
        saker_ai_flagged: totalAiSaker,
        vedtak_upserted: totalVedtak,
        vedtak_ai_flagged: totalAiVedtak,
        per_session: perSession,
      },
    });

    return {
      status: "success",
      job_id: job.id,
      sessions: sessions.length,
      saker_upserted: totalSaker,
      vedtak_upserted: totalVedtak,
      saker_ai_flagged: totalAiSaker,
      vedtak_ai_flagged: totalAiVedtak,
      per_session: perSession,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finishJob(sb, job.id, { status: "failed", error: msg.slice(0, 1000) });
    throw err;
  }
}

// ---- Retag --------------------------------------------------------------

// Re-apply the current canonical keyword matcher to every storting_saker +
// storting_vedtak row. Forward-only ingest means historical rows keep the
// matcher's verdict from their ingest time; without a periodic retag, the
// is_ai flags drift as canonical keywords get promoted (same pattern as
// NAV's reprocessNavPostings).
//
// PAGE_SIZE bounds the per-tick page so the orchestrator can heartbeat in
// the middle of a large corpus; the total corpus is small enough (~tens
// of thousands of saker across 8 sessions) that one run handles it.
const RETAG_PAGE_SIZE = 500;

export async function retagStorting({ sb, trigger = "manual" }) {
  const [job] = await sb(`/jobs`, {
    service: true,
    method: "POST",
    body: { name: RETAG_JOB, trigger },
    prefer: "return=representation",
  });

  try {
    await heartbeat(sb, job.id, { step: "loading matchers" });
    const keywords = await loadActiveOffentligKeywords(sb);
    const matchers = compileMatchers(keywords);
    const ctx = { matchers };

    // --- Saker retag ---
    let offset = 0;
    let sakerProcessed = 0;
    let sakerChanged = 0;
    const nowIso = new Date().toISOString();

    while (true) {
      const rows = await sb(
        `/storting_saker?select=sak_id,tittel,korttittel,emne_liste,raw_jsonb&order=sak_id.asc&offset=${offset}&limit=${RETAG_PAGE_SIZE}`,
        { service: true },
      );
      if (rows.length === 0) break;
      // Re-tag from raw_jsonb (cheap; matches ingest-time behaviour).
      const patch = rows.map((r) => {
        const sak = r.raw_jsonb || {
          id: r.sak_id,
          tittel: r.tittel,
          korttittel: r.korttittel,
          emne_liste: r.emne_liste,
        };
        const built = buildSakRow(sak, { ...ctx, sesjon_id: null });
        if (!built) return null;
        return {
          sak_id: r.sak_id,
          has_ai_in_title: built.has_ai_in_title,
          has_ai_in_emner: built.has_ai_in_emner,
          matched_keywords_title: built.matched_keywords_title,
          matched_keywords_emner: built.matched_keywords_emner,
          retagged_at: nowIso,
        };
      }).filter(Boolean);

      if (patch.length) {
        await sb(`/storting_saker?on_conflict=sak_id`, {
          service: true,
          method: "POST",
          body: patch,
          prefer: "return=minimal,resolution=merge-duplicates",
        });
        sakerChanged += patch.length;
      }
      sakerProcessed += rows.length;
      offset += rows.length;
      const pct = Math.min(50, Math.round((sakerProcessed / 10000) * 50));
      await heartbeat(sb, job.id, {
        pct,
        step: `retagged ${sakerProcessed} saker`,
      });
      if (rows.length < RETAG_PAGE_SIZE) break;
    }

    // --- Vedtak retag ---
    offset = 0;
    let vedtakProcessed = 0;
    let vedtakChanged = 0;

    while (true) {
      const rows = await sb(
        `/storting_vedtak?select=vedtak_id,tekst,tittel,raw_jsonb&order=vedtak_id.asc&offset=${offset}&limit=${RETAG_PAGE_SIZE}`,
        { service: true },
      );
      if (rows.length === 0) break;
      const patch = rows.map((r) => {
        const vedtak = r.raw_jsonb || {
          id: r.vedtak_id,
          stortingsvedtak_tittel: r.tittel,
          stortingsvedtak_tekst: r.tekst,
        };
        const built = buildVedtakRow(vedtak, { ...ctx, sesjon_id: null });
        if (!built) return null;
        return {
          vedtak_id: r.vedtak_id,
          has_ai_in_text: built.has_ai_in_text,
          matched_keywords: built.matched_keywords,
          retagged_at: nowIso,
        };
      }).filter(Boolean);

      if (patch.length) {
        await sb(`/storting_vedtak?on_conflict=vedtak_id`, {
          service: true,
          method: "POST",
          body: patch,
          prefer: "return=minimal,resolution=merge-duplicates",
        });
        vedtakChanged += patch.length;
      }
      vedtakProcessed += rows.length;
      offset += rows.length;
      const pct = 50 + Math.min(50, Math.round((vedtakProcessed / 10000) * 50));
      await heartbeat(sb, job.id, {
        pct,
        step: `retagged ${vedtakProcessed} vedtak`,
      });
      if (rows.length < RETAG_PAGE_SIZE) break;
    }

    await finishJob(sb, job.id, {
      status: "success",
      rows_processed: sakerChanged + vedtakChanged,
      progress_pct: 100,
      metadata: {
        saker_processed: sakerProcessed,
        saker_changed: sakerChanged,
        vedtak_processed: vedtakProcessed,
        vedtak_changed: vedtakChanged,
      },
    });

    return {
      status: "success",
      job_id: job.id,
      saker_processed: sakerProcessed,
      saker_changed: sakerChanged,
      vedtak_processed: vedtakProcessed,
      vedtak_changed: vedtakChanged,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finishJob(sb, job.id, { status: "failed", error: msg.slice(0, 1000) });
    throw err;
  }
}
