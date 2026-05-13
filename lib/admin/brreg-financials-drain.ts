// lib/admin/brreg-financials-drain.ts — full-backfill drain of the BRREG
// financials pool (AI-flagged orgnrs without recent Regnskapsregisteret
// data). Wraps the per-row body used by drainFinancials() in
// legacy/brreg-financials.js, but owns a single jobs row and loops in
// chunks until the candidate list is empty or the operator cancels.
//
// Pacing comes from brreg-financials-client.js's 250 ms polite delay —
// roughly 500 ms wall-per-row including DB writes. A 21k drain therefore
// takes ~3 h wall-clock. The drain is idempotent — if kiba-web restarts
// mid-flight, the watchdog cron re-spawns from wherever fetch_state is at.
//
// Structure mirrors lib/admin/brreg-roles-drain.ts (cancel + reaper +
// heartbeat pattern). Candidate selection differs: roles drain pulls
// from brreg_url_queue; this drain anti-joins brreg_companies (AI-flagged)
// against brreg_financials_fetch_state (180-day retry cadence).

import "server-only";

import { fetchFinancialsForOrgnr } from "@/lib/admin/legacy/brreg-financials-client.js";
import {
  parseFinancialsRow,
  selectAllCandidates,
  upsertFetchState,
  upsertFinancials,
} from "@/lib/admin/legacy/brreg-financials.js";
import type { Sb } from "@/lib/admin/llm-brreg-tier2";

export const BRREG_FINANCIALS_DRAIN_JOB_NAME = "brreg_financials_full_drain";

const CHUNK_SIZE = 100;

// Heartbeats fire every 10 rows (~5 s on a healthy drain). 3 min covers
// ~36 heartbeat cycles of slack while still catching deploy/OOM deaths
// fast enough for the */5-min watchdog cron to auto-resume within one tick.
const STALE_HEARTBEAT_MS = 3 * 60 * 1000;

type JobLite = { id: string; metadata: Record<string, unknown> | null };

// ---- Jobs-table helpers -------------------------------------------------

export async function findLiveBrregFinancialsDrainJob(
  sb: Sb,
): Promise<JobLite | null> {
  const rows = await sb<JobLite[]>(
    `/jobs?name=eq.${BRREG_FINANCIALS_DRAIN_JOB_NAME}&status=eq.running` +
      `&finished_at=is.null&select=id,metadata&order=started_at.desc&limit=1`,
    { service: true },
  );
  return rows[0] ?? null;
}

// Reap drains whose heartbeat hasn't ticked for STALE_HEARTBEAT_MS — the
// signature of a kiba-web restart that killed the JS process mid-loop.
// Returns the number reaped so callers can decide whether to auto-resume.
export async function reapStaleBrregFinancialsDrains(sb: Sb): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_HEARTBEAT_MS).toISOString();
  const stale = await sb<{ id: string }[]>(
    `/jobs?name=eq.${BRREG_FINANCIALS_DRAIN_JOB_NAME}&status=eq.running` +
      `&finished_at=is.null&last_heartbeat=lt.${encodeURIComponent(cutoff)}` +
      `&select=id`,
    { service: true },
  );
  if (!stale.length) return 0;
  const idList = stale.map((r) => encodeURIComponent(r.id)).join(",");
  await sb(`/jobs?id=in.(${idList})`, {
    service: true,
    method: "PATCH",
    body: {
      status: "failed",
      finished_at: new Date().toISOString(),
      error: "Reaped: heartbeat stale (3+ min — likely deploy/OOM)",
    },
    prefer: "return=minimal",
  });
  return stale.length;
}

export async function insertBrregFinancialsDrainJob(
  sb: Sb,
  initialBacklog: number,
  trigger: "manual" | "watchdog" = "manual",
): Promise<{ id: string }> {
  const now = new Date().toISOString();
  const [row] = await sb<{ id: string }[]>(`/jobs`, {
    service: true,
    method: "POST",
    body: {
      name: BRREG_FINANCIALS_DRAIN_JOB_NAME,
      trigger,
      metadata: {
        initial_backlog: initialBacklog,
        chunk_size: CHUNK_SIZE,
      },
      current_step: `0 / ${initialBacklog} · venter…`,
      progress_pct: 0,
      last_heartbeat: now,
    },
    prefer: "return=representation",
  });
  return row;
}

export async function markBrregFinancialsDrainCancelled(sb: Sb) {
  const live = await findLiveBrregFinancialsDrainJob(sb);
  if (!live) return;
  const next = {
    ...(live.metadata ?? {}),
    cancel_requested_at: new Date().toISOString(),
  };
  await sb(`/jobs?id=eq.${encodeURIComponent(live.id)}`, {
    service: true,
    method: "PATCH",
    body: { metadata: next },
    prefer: "return=minimal",
  });
}

async function isCancelRequested(sb: Sb, jobId: string): Promise<boolean> {
  try {
    const rows = await sb<JobLite[]>(
      `/jobs?id=eq.${encodeURIComponent(jobId)}&select=id,metadata`,
      { service: true },
    );
    const meta = rows[0]?.metadata ?? {};
    return typeof (meta as { cancel_requested_at?: unknown })
      .cancel_requested_at === "string";
  } catch {
    return false;
  }
}

async function patchJobProgress(
  sb: Sb,
  jobId: string,
  step: string,
  pct: number | null,
  metaPatch: Record<string, unknown>,
) {
  let prev: Record<string, unknown> = {};
  try {
    const rows = await sb<JobLite[]>(
      `/jobs?id=eq.${encodeURIComponent(jobId)}&select=id,metadata`,
      { service: true },
    );
    prev = rows[0]?.metadata ?? {};
  } catch {
    // ignore
  }
  const body: Record<string, unknown> = {
    last_heartbeat: new Date().toISOString(),
    current_step: step.slice(0, 200),
    metadata: { ...prev, ...metaPatch },
  };
  if (typeof pct === "number" && Number.isFinite(pct)) {
    body.progress_pct = Math.max(0, Math.min(100, pct));
  }
  try {
    await sb(`/jobs?id=eq.${encodeURIComponent(jobId)}`, {
      service: true,
      method: "PATCH",
      body,
      prefer: "return=minimal",
    });
  } catch (err) {
    console.error(
      `brreg financials-drain heartbeat ${jobId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function finalizeJob(
  sb: Sb,
  jobId: string,
  status: "success" | "failed",
  rowsProcessed: number,
  step: string,
  metaPatch: Record<string, unknown>,
  errorMessage?: string,
) {
  let prev: Record<string, unknown> = {};
  try {
    const rows = await sb<JobLite[]>(
      `/jobs?id=eq.${encodeURIComponent(jobId)}&select=id,metadata`,
      { service: true },
    );
    prev = rows[0]?.metadata ?? {};
  } catch {
    // ignore
  }
  const body: Record<string, unknown> = {
    finished_at: new Date().toISOString(),
    status,
    rows_processed: rowsProcessed,
    current_step: step.slice(0, 200),
    metadata: { ...prev, ...metaPatch, finished_summary: step.slice(0, 200) },
  };
  if (errorMessage) body.error = errorMessage.slice(0, 1000);
  await sb(`/jobs?id=eq.${encodeURIComponent(jobId)}`, {
    service: true,
    method: "PATCH",
    body,
    prefer: "return=minimal",
  });
}

// ---- Backlog count ------------------------------------------------------

// Computed by the same anti-join as selectAllCandidates — pulled from the
// shared legacy helper so the count and the burst process the same pool.
export async function countBrregFinancialsBacklog(sb: Sb): Promise<number> {
  try {
    const all = (await selectAllCandidates(sb)) as string[];
    return all.length;
  } catch {
    return 0;
  }
}

// ---- Progress step formatting ------------------------------------------

// 500 ms wall-per-row: 250 ms polite delay in brreg-financials-client.js
// plus ~250 ms for the per-row sequence (fetch + parse + 2 PostgREST writes).
const WALL_SEC_PER_ROW = 0.5;

function formatEta(remainingRows: number): string {
  const secs = Math.max(0, remainingRows) * WALL_SEC_PER_ROW;
  if (secs < 60) return `~${Math.ceil(secs)}s igjen`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `~${mins}m igjen`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins - hrs * 60;
  return `~${hrs}h ${remMins}m igjen`;
}

type Counters = {
  processed: number;
  okFilings: number;
  noFilings: number;
  httpError: number;
};

function renderStep(c: Counters, backlog: number): string {
  const remaining = Math.max(0, backlog - c.processed);
  return (
    `${c.processed.toLocaleString("nb-NO")} / ${backlog.toLocaleString("nb-NO")} ` +
    `· ok=${c.okFilings} · none=${c.noFilings} · err=${c.httpError} ` +
    `· ${formatEta(remaining)}`
  );
}

function renderFinalStep(
  c: Counters,
  backlog: number,
  stopReason: string,
  elapsedSec: number,
): string {
  const mins = Math.floor(elapsedSec / 60);
  const secs = elapsedSec - mins * 60;
  const elapsed = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  return (
    `${stopReason} · ${c.processed.toLocaleString("nb-NO")} / ${backlog.toLocaleString("nb-NO")} ` +
    `· ok=${c.okFilings} · none=${c.noFilings} · err=${c.httpError} · ${elapsed}`
  );
}

// ---- Main entry point ---------------------------------------------------

type FinancialsResponse = { http_status: number; payload: unknown };

export async function runBrregFinancialsFullDrain(args: {
  sb: Sb;
  jobId: string;
  initialBacklog: number;
}): Promise<void> {
  const { sb, jobId, initialBacklog } = args;
  const startMs = Date.now();
  const counters: Counters = {
    processed: 0,
    okFilings: 0,
    noFilings: 0,
    httpError: 0,
  };
  let stopReason = "pool_drained";

  try {
    // Pull the full candidate list ONCE upfront. At ~21k orgnrs + 21k
    // fetch_state rows this is two ~1 MB JSON fetches; cheap. The
    // alternative — re-querying per chunk — costs ~210 redundant fetches
    // of the entire AI population. The 250 ms polite pacing of the per-
    // orgnr fetches dominates wall-time regardless. The race window with
    // the hourly :18 cron is bounded to ~3-5 dupes over a 3-5h burst,
    // each one a single wasted HTTP call (fetch_state guards the upsert).
    const candidates = (await selectAllCandidates(sb)) as string[];

    if (!candidates.length) {
      stopReason = "pool_empty";
    }

    for (let i = 0; i < candidates.length; i += CHUNK_SIZE) {
      if (await isCancelRequested(sb, jobId)) {
        stopReason = "cancelled";
        break;
      }
      const chunk = candidates.slice(i, i + CHUNK_SIZE);

      for (const orgnr of chunk) {
        if (await isCancelRequested(sb, jobId)) {
          stopReason = "cancelled";
          break;
        }
        counters.processed++;

        try {
          const r = (await fetchFinancialsForOrgnr(orgnr)) as FinancialsResponse;
          if (r.http_status === 404) {
            await upsertFetchState(sb, orgnr, "NO_FILINGS");
            counters.noFilings++;
            continue;
          }
          if (r.http_status !== 200) {
            await upsertFetchState(
              sb,
              orgnr,
              "HTTP_ERROR",
              `HTTP ${r.http_status}`,
            );
            counters.httpError++;
            continue;
          }
          const filings = Array.isArray(r.payload) ? r.payload : [];
          if (filings.length === 0) {
            await upsertFetchState(sb, orgnr, "NO_FILINGS");
            counters.noFilings++;
            continue;
          }
          const rows = filings
            .map((f) => parseFinancialsRow(orgnr, f))
            .filter(Boolean);
          if (rows.length === 0) {
            // Malformed payload — won't help to retry; mark NO_FILINGS
            // so we don't burn budget on it for 180 days.
            await upsertFetchState(sb, orgnr, "NO_FILINGS");
            counters.noFilings++;
            continue;
          }
          await upsertFinancials(sb, rows);
          await upsertFetchState(sb, orgnr, "OK");
          counters.okFilings++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          try {
            await upsertFetchState(sb, orgnr, "HTTP_ERROR", msg);
          } catch {
            // best-effort — fetch-state write failed, swallow
          }
          counters.httpError++;
        }

        if (counters.processed % 10 === 0) {
          const pct = Math.min(
            100,
            (counters.processed / Math.max(initialBacklog, 1)) * 100,
          );
          await patchJobProgress(
            sb,
            jobId,
            renderStep(counters, initialBacklog),
            pct,
            { ...counters },
          );
        }
      }

      if (stopReason === "cancelled") break;
    }

    const elapsedSec = Math.round((Date.now() - startMs) / 1000);
    await finalizeJob(
      sb,
      jobId,
      "success",
      counters.processed,
      renderFinalStep(counters, initialBacklog, stopReason, elapsedSec),
      { ...counters, stopped: stopReason, wall_seconds: elapsedSec },
    );
  } catch (err) {
    const elapsedSec = Math.round((Date.now() - startMs) / 1000);
    const message = err instanceof Error ? err.message : String(err);
    await finalizeJob(
      sb,
      jobId,
      "failed",
      counters.processed,
      renderFinalStep(counters, initialBacklog, "error", elapsedSec),
      { ...counters, stopped: "error", wall_seconds: elapsedSec },
      message,
    );
  }
}

