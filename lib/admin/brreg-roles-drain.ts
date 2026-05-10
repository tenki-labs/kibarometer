// lib/admin/brreg-roles-drain.ts — full-backlog drain of the BRREG
// role-fetch queue (brreg_url_queue). Wraps the same per-row body as
// enrichRolesBrreg() in legacy/brreg.js, but owns a single jobs row and
// loops in chunks until the queue is empty or the operator cancels.
//
// Pacing comes from brreg-client's built-in 250 ms polite delay; we
// never run more than one /enheter/{orgnr}/roller fetch in flight, so a
// 130k drain takes ~9 hours wall-clock. The drain is idempotent — if
// kiba-web restarts mid-flight, re-clicking the button continues from
// wherever the queue is at.
//
// Structure mirrors lib/admin/llm-brreg-tier2-claude.ts so the cancel +
// reaper + heartbeat patterns are uniform across long-running drains.
// The per-row body is duplicated from legacy/brreg.js (replaceRoles,
// updateRollup, markQueue) to keep this module self-contained TS.

import "server-only";

import { fetchRollerForOrgnr } from "@/lib/admin/legacy/brreg-client.js";
import { processRollerPayload } from "@/lib/admin/legacy/brreg-processor.js";
import type { Sb } from "@/lib/admin/llm-brreg-tier2";

export const BRREG_ROLES_DRAIN_JOB_NAME = "enrich_brreg_roles_drain";

const CHUNK_SIZE = 100;
const ROLE_FETCH_MAX_ATTEMPTS = 3;
const POLITE_DELAY_MS = 250; // matches brreg-client.js; used for ETA only

type JobLite = { id: string; metadata: Record<string, unknown> | null };

// Heartbeats fire every 10 rows (~2.5 s on a healthy drain at the 250 ms
// polite pace). 3 min covers ≈70 heartbeat cycles of slack while still
// catching deploy/OOM deaths fast enough for the */5-min watchdog cron
// to auto-resume within one tick.
const STALE_HEARTBEAT_MS = 3 * 60 * 1000;

// ---- Jobs-table helpers -------------------------------------------------

export async function findLiveBrregRolesDrainJob(
  sb: Sb,
): Promise<JobLite | null> {
  const rows = await sb<JobLite[]>(
    `/jobs?name=eq.${BRREG_ROLES_DRAIN_JOB_NAME}&status=eq.running` +
      `&finished_at=is.null&select=id,metadata&order=started_at.desc&limit=1`,
    { service: true },
  );
  return rows[0] ?? null;
}

// Reap drains whose heartbeat hasn't ticked for STALE_HEARTBEAT_MS — the
// signature of a kiba-web restart (deploy / OOM / reboot) that killed
// the JS process mid-loop. Returns the number reaped so callers can
// decide whether to auto-resume. last_heartbeat is bootstrapped at
// insert time, so a fresh drain row is never null.
export async function reapStaleBrregRolesDrains(sb: Sb): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_HEARTBEAT_MS).toISOString();
  const stale = await sb<{ id: string }[]>(
    `/jobs?name=eq.${BRREG_ROLES_DRAIN_JOB_NAME}&status=eq.running` +
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

export async function insertBrregRolesDrainJob(
  sb: Sb,
  initialBacklog: number,
  trigger: "manual" | "watchdog" = "manual",
): Promise<{ id: string }> {
  const now = new Date().toISOString();
  const [row] = await sb<{ id: string }[]>(`/jobs`, {
    service: true,
    method: "POST",
    body: {
      name: BRREG_ROLES_DRAIN_JOB_NAME,
      trigger,
      metadata: {
        initial_backlog: initialBacklog,
        chunk_size: CHUNK_SIZE,
      },
      current_step: `0 / ${initialBacklog} · venter…`,
      progress_pct: 0,
      // Bootstrap so reapStaleBrregRolesDrains never sees a null
      // heartbeat (would otherwise need a compound or= filter).
      last_heartbeat: now,
    },
    prefer: "return=representation",
  });
  return row;
}

export async function markBrregRolesDrainCancelled(sb: Sb) {
  const live = await findLiveBrregRolesDrainJob(sb);
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
      `brreg roles-drain heartbeat ${jobId}: ${err instanceof Error ? err.message : String(err)}`,
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

export async function countBrregRolesBacklog(sb: Sb): Promise<number> {
  try {
    const rows = await sb<{ count: number }[] | { count: number }>(
      `/brreg_url_queue?status=eq.pending&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    );
    if (Array.isArray(rows)) return rows[0]?.count ?? 0;
    return rows.count ?? 0;
  } catch {
    return 0;
  }
}

// ---- Per-row PATCH helpers (duplicated from legacy/brreg.js) -----------

type RoleRow = {
  orgnr: string;
  role_code: string;
  person_navn: string;
  fodselsdato: string;
  valid_from: string | null;
};

async function replaceRolesForOrgnr(sb: Sb, orgnr: string, roles: RoleRow[]) {
  await sb(`/brreg_roles?orgnr=eq.${encodeURIComponent(orgnr)}`, {
    service: true,
    method: "DELETE",
    prefer: "return=minimal",
  });
  if (!roles.length) return;
  await sb(`/brreg_roles`, {
    service: true,
    method: "POST",
    body: roles.map((r) => ({
      orgnr: r.orgnr,
      role_code: r.role_code,
      person_navn: r.person_navn,
      fodselsdato: r.fodselsdato,
      valid_from: r.valid_from,
    })),
    prefer: "return=minimal",
  });
}

async function updateCompanyRollup(
  sb: Sb,
  orgnr: string,
  rollup: { youngest_age_at_reg: number | null; role_count: number },
) {
  await sb(`/brreg_companies?orgnr=eq.${encodeURIComponent(orgnr)}`, {
    service: true,
    method: "PATCH",
    body: {
      roles_fetched_at: new Date().toISOString(),
      youngest_role_age_at_reg: rollup.youngest_age_at_reg,
      role_count: rollup.role_count,
    },
    prefer: "return=minimal",
  });
}

async function markQueue(
  sb: Sb,
  orgnr: string,
  patch: { status: string; attempts: number; lastError?: string | null },
) {
  await sb(`/brreg_url_queue?orgnr=eq.${encodeURIComponent(orgnr)}`, {
    service: true,
    method: "PATCH",
    body: {
      status: patch.status,
      attempts: patch.attempts,
      last_error: patch.lastError ?? null,
    },
    prefer: "return=minimal",
  });
}

// ---- Progress step formatting ------------------------------------------

function formatEta(remainingRows: number): string {
  const secs = Math.max(0, remainingRows) * (POLITE_DELAY_MS / 1000);
  if (secs < 60) return `~${Math.ceil(secs)}s igjen`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `~${mins}m igjen`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins - hrs * 60;
  return `~${hrs}h ${remMins}m igjen`;
}

type Counters = {
  processed: number;
  succeeded: number;
  noRoles: number;
  failed: number;
};

function renderStep(c: Counters, backlog: number): string {
  const remaining = Math.max(0, backlog - c.processed);
  return (
    `${c.processed.toLocaleString("nb-NO")} / ${backlog.toLocaleString("nb-NO")} ` +
    `· ok=${c.succeeded} · no_roles=${c.noRoles} · fail=${c.failed} ` +
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
    `· ok=${c.succeeded} · no_roles=${c.noRoles} · fail=${c.failed} · ${elapsed}`
  );
}

// ---- Main entry point ---------------------------------------------------

type RollerResponse = { http_status: number; payload: unknown };

export async function runBrregRolesFullDrain(args: {
  sb: Sb;
  jobId: string;
  initialBacklog: number;
}): Promise<void> {
  const { sb, jobId, initialBacklog } = args;
  const startMs = Date.now();
  const counters: Counters = {
    processed: 0,
    succeeded: 0,
    noRoles: 0,
    failed: 0,
  };
  let stopReason = "queue_empty";

  try {
    while (true) {
      if (await isCancelRequested(sb, jobId)) {
        stopReason = "cancelled";
        break;
      }

      type QueueRow = { orgnr: string; attempts: number | null };
      const pending = await sb<QueueRow[]>(
        `/brreg_url_queue?status=eq.pending&order=enqueued_at.asc` +
          `&limit=${CHUNK_SIZE}&select=orgnr,attempts`,
        { service: true },
      );

      if (!pending.length) {
        stopReason = "queue_empty";
        break;
      }

      // One-shot lookup of registrert_dato for the chunk — drives the
      // founder-age math inside processRollerPayload.
      const orgnrs = pending.map((p) => p.orgnr);
      const inList = orgnrs.map(encodeURIComponent).join(",");
      type CompanyDate = { orgnr: string; registrert_dato: string | null };
      const companies = await sb<CompanyDate[]>(
        `/brreg_companies?orgnr=in.(${inList})&select=orgnr,registrert_dato`,
        { service: true },
      );
      const regDateByOrgnr = new Map(
        companies.map((c) => [c.orgnr, c.registrert_dato]),
      );

      for (const row of pending) {
        if (await isCancelRequested(sb, jobId)) {
          stopReason = "cancelled";
          break;
        }
        counters.processed++;
        const orgnr = row.orgnr;
        const attempts = (row.attempts ?? 0) + 1;
        const regDate = regDateByOrgnr.get(orgnr) ?? null;

        try {
          const r = (await fetchRollerForOrgnr(orgnr)) as RollerResponse;
          if (r.http_status === 404) {
            // brreg has no registered roles — common for foreninger / ENKs.
            // Treat as success with empty role set so we don't re-fetch.
            await replaceRolesForOrgnr(sb, orgnr, []);
            await updateCompanyRollup(sb, orgnr, {
              youngest_age_at_reg: null,
              role_count: 0,
            });
            await markQueue(sb, orgnr, { status: "fetched", attempts });
            counters.noRoles++;
            continue;
          }
          if (r.http_status !== 200) {
            throw new Error(`brreg /roller HTTP ${r.http_status}`);
          }
          const result = processRollerPayload(orgnr, r.payload, regDate) as {
            roles: RoleRow[];
            youngest_age_at_reg: number | null;
            role_count: number;
          };
          await replaceRolesForOrgnr(sb, orgnr, result.roles);
          await updateCompanyRollup(sb, orgnr, {
            youngest_age_at_reg: result.youngest_age_at_reg,
            role_count: result.role_count,
          });
          await markQueue(sb, orgnr, { status: "fetched", attempts });
          counters.succeeded++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const terminal = attempts >= ROLE_FETCH_MAX_ATTEMPTS;
          await markQueue(sb, orgnr, {
            status: terminal ? "failed" : "pending",
            attempts,
            lastError: msg.slice(0, 500),
          });
          if (terminal) counters.failed++;
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
