// lib/admin/llm-classify-claude.ts — NAV Tier 2 full-backlog drain via
// Anthropic Claude Haiku 4.5. Manual-only path; the live MLX cron in
// llm-classify.ts is untouched.
//
// Loop shape:
//   1. Load active prompt + taxonomy + cached system string ONCE per drain.
//   2. Loop chunks of CHUNK_SIZE (oldest-first):
//      a. SELECT next chunk where tier2_completed_at is null.
//      b. If 0 rows OR jobs.metadata.cancel_requested_at set → break.
//      c. Process chunk via pLimit(concurrency); each task calls
//         anthropicChat() with the cached system prompt.
//      d. Roll cumulative counters; PATCH jobs.metadata + last_heartbeat.
//   3. On exit, finalize the jobs row.
//
// Auth failure aborts the entire drain. Parse / rate_limit / server / unreachable
// errors bump that row's llm_retry_count and continue.
//
// DB contract identical to llm-classify.ts; the only addition is
// llm_categories.model_version stamping the Claude model so we can audit
// which provider classified which row.

import "server-only";

import pLimit from "p-limit";

import {
  AnthropicError,
  anthropicChat,
  anthropicConfigured,
  estimateCostUsd,
  type AnthropicChatUsage,
} from "@/lib/admin/anthropic";
import { loadActivePrompt } from "@/lib/admin/llm-prompts";
import {
  buildCategoriesBlock,
  loadCurrentTaxonomyVersion,
  loadLiveTaxonomy,
  type Posting,
  type Sb,
  type TaxonomyRow,
} from "@/lib/admin/llm-classify";

export const NAV_CLAUDE_JOB_NAME = "claude_drain_nav";

const CHUNK_SIZE = 50;
const RETRY_LIMIT = 3;
const MAX_CATEGORIES_PER_POSTING = 3;
const MAX_RATIONALE_CHARS = 400;
const TIER2_MAX_TOKENS = 600;
const DEFAULT_CONCURRENCY = 4;

const TOOL_NAME = "submit_categories";
const TOOL_DESCRIPTION =
  "Returner tier-2 kategorisering for stillingen. Bruk maks 3 kategorier fra taksonomien gitt i system-prompten.";

type ClaudeCategoryAssignment = { slug: string; confidence: number };
type ClaudeTier2Output = {
  categories: ClaudeCategoryAssignment[];
  rationale: string;
};

type CumulativeCounters = {
  processed: number;
  parseFails: number;
  authFails: number;
  rateLimitFails: number;
  serverFails: number;
  unreachableFails: number;
  invalidSlugDrops: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreateTokens: number;
  cacheReadTokens: number;
  costUsd: number;
};

function emptyCounters(): CumulativeCounters {
  return {
    processed: 0,
    parseFails: 0,
    authFails: 0,
    rateLimitFails: 0,
    serverFails: 0,
    unreachableFails: 0,
    invalidSlugDrops: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreateTokens: 0,
    cacheReadTokens: 0,
    costUsd: 0,
  };
}

function rollUsage(c: CumulativeCounters, usage: AnthropicChatUsage) {
  c.inputTokens += usage.input_tokens;
  c.outputTokens += usage.output_tokens;
  c.cacheCreateTokens += usage.cache_creation_input_tokens;
  c.cacheReadTokens += usage.cache_read_input_tokens;
  c.costUsd += estimateCostUsd(usage);
}

function buildToolSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["categories", "rationale"],
    properties: {
      categories: {
        type: "array",
        maxItems: MAX_CATEGORIES_PER_POSTING,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["slug", "confidence"],
          properties: {
            slug: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
        },
      },
      rationale: { type: "string", maxLength: MAX_RATIONALE_CHARS },
    },
  };
}

function clampConfidence(c: unknown): number {
  if (typeof c !== "number" || !Number.isFinite(c)) return 0.5;
  if (c < 0) return 0;
  if (c > 1) return 1;
  return c;
}

function validateToolOutput(parsed: unknown): ClaudeTier2Output | null {
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as { categories?: unknown; rationale?: unknown };
  if (!Array.isArray(obj.categories)) return null;
  const categories: ClaudeCategoryAssignment[] = [];
  for (const c of obj.categories) {
    if (!c || typeof c !== "object") continue;
    const slug = (c as { slug?: unknown }).slug;
    if (typeof slug !== "string") continue;
    categories.push({
      slug,
      confidence: clampConfidence((c as { confidence?: unknown }).confidence),
    });
  }
  const rationale =
    typeof obj.rationale === "string"
      ? obj.rationale.slice(0, MAX_RATIONALE_CHARS)
      : "";
  return { categories, rationale };
}

// JOBS-table helpers -------------------------------------------------

type JobLite = { id: string; metadata: Record<string, unknown> | null };

export async function findLiveClaudeDrainJob(
  sb: Sb,
  jobName: string,
): Promise<JobLite | null> {
  const rows = await sb<JobLite[]>(
    `/jobs?name=eq.${encodeURIComponent(jobName)}&status=eq.running` +
      `&finished_at=is.null&select=id,metadata&order=started_at.desc&limit=1`,
    { service: true },
  );
  return rows[0] ?? null;
}

// Reap any drain rows that ran but never finalized (container restart,
// crash, etc.). Idempotent — only the matching name + status=running +
// stale heartbeat tuple is touched. Mirrors the heartbeat-stale sweep
// pattern from llm-classify.ts.
const STALE_AFTER_MS = 30 * 60 * 1000;

export async function reapStaleClaudeDrains(sb: Sb, jobName: string) {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();
  await sb(
    `/jobs?name=eq.${encodeURIComponent(jobName)}&status=eq.running` +
      `&finished_at=is.null&started_at=lt.${encodeURIComponent(cutoff)}`,
    {
      service: true,
      method: "PATCH",
      body: {
        status: "failed",
        finished_at: new Date().toISOString(),
        error: "Reaped: stale (no progress for 30+ min)",
      },
      prefer: "return=minimal",
    },
  );
}

export async function insertClaudeDrainJob(
  sb: Sb,
  jobName: string,
  initialBacklog: number,
): Promise<{ id: string }> {
  const [row] = await sb<{ id: string }[]>(`/jobs`, {
    service: true,
    method: "POST",
    body: {
      name: jobName,
      trigger: "manual",
      metadata: {
        initial_backlog: initialBacklog,
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
        chunk_size: CHUNK_SIZE,
      },
      current_step: `0 / ${initialBacklog} · 0 ok · $0.0000`,
      progress_pct: 0,
    },
    prefer: "return=representation",
  });
  return row;
}

export async function markClaudeDrainCancelled(sb: Sb, jobName: string) {
  const live = await findLiveClaudeDrainJob(sb, jobName);
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
  // Read-modify-write metadata so we don't trample cancel_requested_at.
  let prev: Record<string, unknown> = {};
  try {
    const rows = await sb<JobLite[]>(
      `/jobs?id=eq.${encodeURIComponent(jobId)}&select=id,metadata`,
      { service: true },
    );
    prev = rows[0]?.metadata ?? {};
  } catch {
    // ignore — we'll still write fresh metadata below
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
      `claude-drain heartbeat ${jobId}: ${err instanceof Error ? err.message : String(err)}`,
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

// Per-row PATCH helpers ----------------------------------------------

async function persistSuccess(
  sb: Sb,
  posting: Posting,
  output: ClaudeTier2Output,
  validSlugs: Set<string>,
  taxonomyVersion: number,
  promptId: string,
  modelVersion: string,
): Promise<{ invalidSlugDrops: number }> {
  const accepted: ClaudeCategoryAssignment[] = [];
  let invalidSlugDrops = 0;
  for (const c of output.categories) {
    if (!validSlugs.has(c.slug)) {
      invalidSlugDrops += 1;
      continue;
    }
    accepted.push({ slug: c.slug, confidence: c.confidence });
    if (accepted.length >= MAX_CATEGORIES_PER_POSTING) break;
  }

  const persisted = {
    categories: accepted,
    rationale: output.rationale.slice(0, MAX_RATIONALE_CHARS),
    invalid_slugs_dropped: invalidSlugDrops,
    model_version: modelVersion,
    provider: "anthropic",
  };

  await sb(`/nav_postings?id=eq.${encodeURIComponent(posting.id)}`, {
    service: true,
    method: "PATCH",
    body: {
      llm_categories: persisted,
      tier2_completed_at: new Date().toISOString(),
      llm_status: "tier2_ok",
      llm_taxonomy_version: taxonomyVersion,
      llm_prompt_id: promptId,
    },
    prefer: "return=minimal",
  });

  return { invalidSlugDrops };
}

async function markRowFailed(
  sb: Sb,
  postingId: string,
  status: string,
  bumpRetry: boolean,
) {
  try {
    let nextRetry: number | undefined;
    if (bumpRetry) {
      const rows = await sb<{ llm_retry_count: number | null }[]>(
        `/nav_postings?id=eq.${encodeURIComponent(postingId)}` +
          `&select=llm_retry_count`,
        { service: true },
      );
      const current = rows[0]?.llm_retry_count ?? 0;
      nextRetry = current + 1;
    }
    const body: Record<string, unknown> = { llm_status: status };
    if (typeof nextRetry === "number") body.llm_retry_count = nextRetry;
    await sb(`/nav_postings?id=eq.${encodeURIComponent(postingId)}`, {
      service: true,
      method: "PATCH",
      body,
      prefer: "return=minimal",
    });
  } catch (err) {
    console.error(
      `claude markRowFailed ${postingId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// Backlog count for the start-flash + jobs.metadata.initial_backlog.
export async function countNavTier2Backlog(sb: Sb): Promise<number> {
  try {
    const rows = await sb<{ count: number }[] | { count: number }>(
      `/nav_postings?is_ai=is.true&tier2_completed_at=is.null` +
        `&llm_retry_count=lt.${RETRY_LIMIT}&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    );
    if (Array.isArray(rows)) return rows[0]?.count ?? 0;
    return rows.count ?? 0;
  } catch {
    return 0;
  }
}

// Main entry point ----------------------------------------------------

export async function runClassifyClaudeFullDrain(args: {
  sb: Sb;
  jobId: string;
  initialBacklog: number;
}): Promise<void> {
  const { sb, jobId, initialBacklog } = args;
  const startMs = Date.now();
  const counters = emptyCounters();

  if (!anthropicConfigured()) {
    await finalizeJob(
      sb,
      jobId,
      "failed",
      0,
      "Aborted: ANTHROPIC_API_KEY mangler",
      { stopped: "no_api_key" },
      "ANTHROPIC_API_KEY not set",
    );
    return;
  }

  let prompt: { id: string; body: string } | null = null;
  let taxonomy: TaxonomyRow[] = [];
  let taxonomyVersion = 1;
  try {
    [prompt, taxonomy, taxonomyVersion] = await Promise.all([
      loadActivePrompt(sb, "tier2"),
      loadLiveTaxonomy(sb),
      loadCurrentTaxonomyVersion(sb),
    ]);
  } catch (err) {
    await finalizeJob(
      sb,
      jobId,
      "failed",
      0,
      "Aborted: kunne ikke laste prompt eller taksonomi",
      { stopped: "prompt_load_failed" },
      err instanceof Error ? err.message : String(err),
    );
    return;
  }

  if (!prompt || taxonomy.length === 0) {
    await finalizeJob(
      sb,
      jobId,
      "failed",
      0,
      "Aborted: ingen aktiv tier2-prompt eller taksonomi",
      { stopped: "no_taxonomy" },
      "missing prompt or taxonomy",
    );
    return;
  }

  const validSlugs = new Set(taxonomy.map((t) => t.slug));
  const systemPrompt = prompt.body.replace(
    "{{categories_block}}",
    buildCategoriesBlock(taxonomy),
  );

  const concurrency = clampConcurrency(
    Number(process.env.ANTHROPIC_CONCURRENCY) || DEFAULT_CONCURRENCY,
  );
  const limit = pLimit(concurrency);
  const toolSchema = buildToolSchema();

  let stopReason = "queue_empty";
  let totalSeen = 0;

  try {
    while (true) {
      // Cancel check before each chunk.
      if (await isCancelRequested(sb, jobId)) {
        stopReason = "cancelled";
        break;
      }

      const chunk = await sb<Posting[]>(
        `/nav_postings?is_ai=is.true&tier2_completed_at=is.null` +
          `&llm_retry_count=lt.${RETRY_LIMIT}` +
          `&select=id,title,description&order=posted_at.asc&limit=${CHUNK_SIZE}`,
        { service: true },
      );
      if (chunk.length === 0) {
        stopReason = "queue_empty";
        break;
      }

      let authFailedThisChunk = false;

      await Promise.all(
        chunk.map((posting) =>
          limit(async () => {
            if (authFailedThisChunk) return;
            const userInput = `Tittel: ${posting.title ?? ""}\n\n${posting.description ?? ""}`;
            try {
              const resp = await anthropicChat({
                system: systemPrompt,
                user: userInput,
                toolName: TOOL_NAME,
                toolDescription: TOOL_DESCRIPTION,
                toolInputSchema: toolSchema,
                maxTokens: TIER2_MAX_TOKENS,
              });
              rollUsage(counters, resp.usage);
              const validated = validateToolOutput(resp.parsed);
              if (!validated) {
                counters.parseFails += 1;
                await markRowFailed(
                  sb,
                  posting.id,
                  "tier2_parse_failed_claude",
                  true,
                );
                return;
              }
              const { invalidSlugDrops } = await persistSuccess(
                sb,
                posting,
                validated,
                validSlugs,
                taxonomyVersion,
                prompt!.id,
                resp.model,
              );
              counters.processed += 1;
              counters.invalidSlugDrops += invalidSlugDrops;
            } catch (err) {
              if (err instanceof AnthropicError) {
                if (err.kind === "auth") {
                  counters.authFails += 1;
                  authFailedThisChunk = true;
                  await markRowFailed(
                    sb,
                    posting.id,
                    "tier2_auth_failed_claude",
                    false,
                  );
                  return;
                }
                if (err.kind === "rate_limit") counters.rateLimitFails += 1;
                else if (err.kind === "server") counters.serverFails += 1;
                else if (err.kind === "unreachable")
                  counters.unreachableFails += 1;
                else counters.parseFails += 1;
              } else {
                counters.parseFails += 1;
              }
              await markRowFailed(
                sb,
                posting.id,
                err instanceof AnthropicError && err.kind === "parse"
                  ? "tier2_parse_failed_claude"
                  : "tier2_failed_claude",
                true,
              );
            }
          }),
        ),
      );

      totalSeen += chunk.length;

      if (authFailedThisChunk) {
        stopReason = "auth_failed";
        break;
      }

      const elapsedSec = Math.round((Date.now() - startMs) / 1000);
      const denom = Math.max(initialBacklog, counters.processed + 1);
      const pct = Math.min(100, (counters.processed / denom) * 100);
      const step = renderStep({
        counters,
        totalSeen,
        backlog: initialBacklog,
        elapsedSec,
      });
      await patchJobProgress(sb, jobId, step, pct, {
        ...counterSnapshot(counters),
        last_chunk_size: chunk.length,
      });

      if (chunk.length < CHUNK_SIZE) {
        stopReason = "queue_empty";
        break;
      }
    }

    const elapsedSec = Math.round((Date.now() - startMs) / 1000);
    const finalStep = renderFinalStep({
      counters,
      stopReason,
      elapsedSec,
    });
    await finalizeJob(sb, jobId, "success", counters.processed, finalStep, {
      ...counterSnapshot(counters),
      stopped: stopReason,
      wall_seconds: elapsedSec,
    });
  } catch (err) {
    const elapsedSec = Math.round((Date.now() - startMs) / 1000);
    const message = err instanceof Error ? err.message : String(err);
    await finalizeJob(
      sb,
      jobId,
      "failed",
      counters.processed,
      `Crashed: ${message.slice(0, 120)}`,
      {
        ...counterSnapshot(counters),
        stopped: "exception",
        wall_seconds: elapsedSec,
      },
      message,
    );
  }
}

function clampConcurrency(n: number): number {
  if (!Number.isFinite(n) || n < 1) return DEFAULT_CONCURRENCY;
  if (n > 16) return 16;
  return Math.floor(n);
}

function counterSnapshot(c: CumulativeCounters) {
  return {
    processed: c.processed,
    parse_fails: c.parseFails,
    auth_fails: c.authFails,
    rate_limit_fails: c.rateLimitFails,
    server_fails: c.serverFails,
    unreachable_fails: c.unreachableFails,
    invalid_slug_drops: c.invalidSlugDrops,
    input_tokens: c.inputTokens,
    output_tokens: c.outputTokens,
    cache_create_tokens: c.cacheCreateTokens,
    cache_read_tokens: c.cacheReadTokens,
    cost_usd: round4(c.costUsd),
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function renderStep(args: {
  counters: CumulativeCounters;
  totalSeen: number;
  backlog: number;
  elapsedSec: number;
}): string {
  const { counters, totalSeen, backlog, elapsedSec } = args;
  const pct = backlog > 0 ? Math.round((counters.processed / backlog) * 100) : 0;
  const fails =
    counters.parseFails +
    counters.rateLimitFails +
    counters.serverFails +
    counters.unreachableFails;
  return (
    `${counters.processed}/${backlog} (${pct}%) · ` +
    `${formatDuration(elapsedSec)} · $${round4(counters.costUsd).toFixed(4)} · ` +
    `${fails} feil · ${totalSeen} forsøkt`
  );
}

function renderFinalStep(args: {
  counters: CumulativeCounters;
  stopReason: string;
  elapsedSec: number;
}): string {
  const { counters, stopReason, elapsedSec } = args;
  const fails =
    counters.parseFails +
    counters.rateLimitFails +
    counters.serverFails +
    counters.unreachableFails +
    counters.authFails;
  const cacheHitPct =
    counters.cacheReadTokens + counters.cacheCreateTokens + counters.inputTokens > 0
      ? Math.round(
          (counters.cacheReadTokens /
            (counters.cacheReadTokens +
              counters.cacheCreateTokens +
              counters.inputTokens)) *
            100,
        )
      : 0;
  const reasonLabel =
    stopReason === "queue_empty"
      ? "Ferdig"
      : stopReason === "cancelled"
        ? "Stoppet"
        : stopReason === "auth_failed"
          ? "Avbrutt: auth"
          : "Avsluttet";
  return (
    `${reasonLabel} · ${counters.processed} OK · ${fails} feil · ` +
    `${formatDuration(elapsedSec)} · $${round4(counters.costUsd).toFixed(4)} · ` +
    `cache ${cacheHitPct}%`
  );
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

