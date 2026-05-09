// lib/admin/llm-discover.ts — Tier 1 (discovery) orchestrator.
//
// Picks up to K rows from nav_postings where tier1_completed_at is null and
// llm_retry_count < 3, calls mlx.tenki.no, parses the JSON response, drops
// hallucinated phrases via includes()-validation, persists.
//
// System prompt is loaded from public.llm_prompts (role='tier1', active=true)
// — operator-editable via /admin/media/prompts (PR 8). Migration 0018 seeds
// the initial prompt body + few-shot examples (verbatim-extraction).
//
// Concurrency: a same-name job with a fresh heartbeat (< 5 min old) blocks
// new starts via {skipped: 'already_running'}. Stale rows (> 5 min no
// heartbeat, or > 30 min since started_at) are reaped by the sweep in
// lib/admin/legacy/jobs.js — llm_discover is in SWEEPABLE_JOB_NAMES, so
// every enrich-nav cron tick handles the cleanup.

import "server-only";

import { sbFetch } from "@/lib/admin/sb";
import { mlxChat, mlxConfigured, MlxError } from "@/lib/admin/mlx";
import { loadActivePrompt } from "@/lib/admin/llm-prompts";

const JOB_NAME = "llm_discover";

const K_PER_TICK = 15;
const WALL_TIME_MS = 60_000;
const HEARTBEAT_STALE_MS = 5 * 60 * 1000;
const RETRY_LIMIT = 3;

const MIN_PHRASE_LEN = 3;
const MAX_PHRASE_LEN = 80;
const MAX_PHRASES_PER_POSTING = 16;
const MAX_DESCRIPTION_CHARS = 1000;

const TIER1_MODEL_MAX_TOKENS = 400;
const TIER1_MODEL_TEMPERATURE = 0.2;

type Sb = typeof sbFetch;
type Trigger = "manual" | "cron";

type Phrase = { text: string };
type Tier1Output = {
  ai_relevant: boolean;
  phrases: Phrase[];
};

type Posting = {
  id: string;
  title: string | null;
  description: string | null;
};

export type RunDiscoverResult = {
  status: "success" | "skipped";
  reason?: "no_api_key" | "already_running" | "no_prompt";
  job_id?: string;
  metadata?: {
    processed: number;
    ai_relevant: number;
    phrases_persisted: number;
    parse_fails: number;
    http_fails: number;
    auth_fails: number;
    stopped: string;
  };
};

export async function runDiscover(args: {
  sb: Sb;
  trigger: Trigger;
}): Promise<RunDiscoverResult> {
  const { sb, trigger } = args;

  if (!mlxConfigured()) {
    return { status: "skipped", reason: "no_api_key" };
  }
  if (await isRunning(sb)) {
    return { status: "skipped", reason: "already_running" };
  }
  const prompt = await loadActivePrompt(sb, "tier1");
  if (!prompt) {
    return { status: "skipped", reason: "no_prompt" };
  }

  const candidates = await sb<Posting[]>(
    `/nav_postings?tier1_completed_at=is.null&llm_retry_count=lt.${RETRY_LIMIT}` +
      `&ingest_mode=eq.live` +
      `&select=id,title,description&order=posted_at.desc&limit=${K_PER_TICK}`,
    { service: true },
  );

  const [job] = await sb<{ id: string }[]>(`/jobs`, {
    service: true,
    method: "POST",
    body: {
      name: JOB_NAME,
      trigger,
      metadata: { candidates: candidates.length },
    },
    prefer: "return=representation",
  });

  await heartbeat(sb, job.id, {
    pct: 0,
    step: `0 / ${candidates.length} candidates`,
  });

  if (candidates.length === 0) {
    await finalize(sb, job.id, "success", {
      processed: 0,
      ai_relevant: 0,
      phrases_persisted: 0,
      parse_fails: 0,
      http_fails: 0,
      auth_fails: 0,
      stopped: "queue_empty",
    });
    return {
      status: "success",
      job_id: job.id,
      metadata: {
        processed: 0,
        ai_relevant: 0,
        phrases_persisted: 0,
        parse_fails: 0,
        http_fails: 0,
        auth_fails: 0,
        stopped: "queue_empty",
      },
    };
  }

  const start = Date.now();
  let processed = 0;
  let aiRelevant = 0;
  let phrasesPersisted = 0;
  let parseFails = 0;
  let httpFails = 0;
  let authFails = 0;
  let stopped = "K_reached";

  try {
    for (let idx = 0; idx < candidates.length; idx += 1) {
      if (Date.now() - start > WALL_TIME_MS) {
        stopped = "wall_time";
        break;
      }
      const posting = candidates[idx];
      try {
        const r = await processOne(sb, posting, prompt.body, prompt.id);
        processed += 1;
        if (r.aiRelevant) aiRelevant += 1;
        phrasesPersisted += r.phraseCount;
      } catch (err) {
        if (err instanceof MlxError && err.kind === "auth") {
          authFails += 1;
          await markFailed(sb, posting.id, "tier1_auth_failed", false);
          stopped = "auth_failed";
          break;
        }
        if (err instanceof MlxError && err.kind === "parse") {
          parseFails += 1;
          await markFailed(sb, posting.id, "tier1_parse_failed", true);
        } else {
          httpFails += 1;
          await markFailed(sb, posting.id, "tier1_failed", true);
        }
      }
      // Every third row, plus on the last row of the batch.
      if ((idx + 1) % 3 === 0 || idx === candidates.length - 1) {
        await heartbeat(sb, job.id, {
          pct: ((idx + 1) / candidates.length) * 100,
          step:
            `${idx + 1} / ${candidates.length} · ${processed} ok · ` +
            `${aiRelevant} AI · ${parseFails + httpFails + authFails} feil`,
        });
      }
    }

    const meta = {
      processed,
      ai_relevant: aiRelevant,
      phrases_persisted: phrasesPersisted,
      parse_fails: parseFails,
      http_fails: httpFails,
      auth_fails: authFails,
      stopped,
    };
    await finalize(sb, job.id, "success", meta);
    return { status: "success", job_id: job.id, metadata: meta };
  } catch (err) {
    await finalize(sb, job.id, "failed", {
      processed,
      ai_relevant: aiRelevant,
      phrases_persisted: phrasesPersisted,
      parse_fails: parseFails,
      http_fails: httpFails,
      auth_fails: authFails,
      stopped: "exception",
      error: String(err instanceof Error ? err.message : err).slice(0, 1000),
    });
    throw err;
  }
}

async function processOne(
  sb: Sb,
  posting: Posting,
  systemPrompt: string,
  promptId: string,
): Promise<{ aiRelevant: boolean; phraseCount: number }> {
  const description = posting.description ?? "";
  const userInput =
    `Tittel: ${posting.title ?? ""}\n\n` +
    description.slice(0, MAX_DESCRIPTION_CHARS);

  const resp = await mlxChat({
    system: systemPrompt,
    user: userInput,
    maxTokens: TIER1_MODEL_MAX_TOKENS,
    temperature: TIER1_MODEL_TEMPERATURE,
  });

  const parsed = parseTier1(resp.content);
  if (!parsed) {
    throw new MlxError(
      "parse",
      `tier1 output not valid JSON: ${resp.content.slice(0, 200)}`,
    );
  }

  const validatedPhrases = validatePhrases(parsed.phrases, description);
  const persisted = {
    ai_relevant: parsed.ai_relevant,
    phrases: validatedPhrases,
    // Drop count for observability — the gap between returned and persisted
    // phrases is the hallucination signal.
    phrases_returned: parsed.phrases.length,
  };

  await sb(`/nav_postings?id=eq.${encodeURIComponent(posting.id)}`, {
    service: true,
    method: "PATCH",
    body: {
      llm_ai_phrases: persisted,
      tier1_completed_at: new Date().toISOString(),
      llm_status: "tier1_ok",
      llm_prompt_id: promptId,
    },
    prefer: "return=minimal",
  });

  return {
    aiRelevant: parsed.ai_relevant,
    phraseCount: validatedPhrases.length,
  };
}

// Defensive parser. Accepts:
//   * raw JSON
//   * JSON wrapped in ```json ... ``` fences (some Gemma variants do this)
//   * JSON with leading/trailing prose (extracts the first {...} object)
function parseTier1(content: string): Tier1Output | null {
  const stripped = content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const candidate = extractFirstJsonObject(stripped);
  if (!candidate) return null;

  let obj: unknown;
  try {
    obj = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;

  const aiRelevant = Boolean((obj as { ai_relevant?: unknown }).ai_relevant);
  const rawPhrases = (obj as { phrases?: unknown }).phrases;
  if (!Array.isArray(rawPhrases)) {
    return { ai_relevant: aiRelevant, phrases: [] };
  }
  const phrases: Phrase[] = [];
  for (const p of rawPhrases) {
    if (
      p &&
      typeof p === "object" &&
      typeof (p as { text?: unknown }).text === "string"
    ) {
      phrases.push({ text: (p as { text: string }).text });
    }
  }
  return { ai_relevant: aiRelevant, phrases };
}

// Brace-balanced scan that respects strings + escapes. Cheaper than running
// JSON.parse repeatedly with prefix-trimming and handles trailing prose.
function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i += 1) {
    const ch = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

// Verbatim-only filter: every phrase must appear word-for-word in the source
// description (case-insensitive). This is the load-bearing hallucination
// defense — invented phrases are dropped before they reach the DB.
function validatePhrases(phrases: Phrase[], description: string): Phrase[] {
  const haystack = description.toLowerCase();
  const seen = new Set<string>();
  const out: Phrase[] = [];
  for (const p of phrases) {
    if (typeof p?.text !== "string") continue;
    const trimmed = p.text.trim();
    if (trimmed.length < MIN_PHRASE_LEN || trimmed.length > MAX_PHRASE_LEN) {
      continue;
    }
    if (!haystack.includes(trimmed.toLowerCase())) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text: trimmed });
    if (out.length >= MAX_PHRASES_PER_POSTING) break;
  }
  return out;
}

async function isRunning(sb: Sb): Promise<boolean> {
  const cutoff = new Date(Date.now() - HEARTBEAT_STALE_MS).toISOString();
  const rows = await sb<{ id: string }[]>(
    `/jobs?name=eq.${JOB_NAME}&status=eq.running` +
      `&last_heartbeat=gt.${encodeURIComponent(cutoff)}&select=id&limit=1`,
    { service: true },
  );
  return rows.length > 0;
}

// Per-row failure handling. Auth failures don't bump the retry counter —
// retry would just hit the same revoked token. Parse + http bump retry so
// the row eventually leaves the queue after RETRY_LIMIT attempts.
async function markFailed(
  sb: Sb,
  postingId: string,
  status: string,
  bumpRetry: boolean,
): Promise<void> {
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
    // Marking a row failed should never fail the whole tick.
    console.error(
      `markFailed ${postingId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function heartbeat(
  sb: Sb,
  jobId: string,
  opts: { pct?: number; step?: string },
): Promise<void> {
  const body: Record<string, unknown> = {
    last_heartbeat: new Date().toISOString(),
  };
  if (typeof opts.pct === "number" && Number.isFinite(opts.pct)) {
    body.progress_pct = Math.max(0, Math.min(100, opts.pct));
  }
  if (typeof opts.step === "string" && opts.step) {
    body.current_step = opts.step.slice(0, 200);
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
      `heartbeat ${jobId} failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function finalize(
  sb: Sb,
  jobId: string,
  status: "success" | "failed",
  metadata: Record<string, unknown>,
): Promise<void> {
  const body: Record<string, unknown> = {
    finished_at: new Date().toISOString(),
    status,
    rows_processed: typeof metadata.processed === "number" ? metadata.processed : 0,
    metadata,
  };
  if (status === "failed" && typeof metadata.error === "string") {
    body.error = metadata.error;
  }
  await sb(`/jobs?id=eq.${encodeURIComponent(jobId)}`, {
    service: true,
    method: "PATCH",
    body,
  });
}
