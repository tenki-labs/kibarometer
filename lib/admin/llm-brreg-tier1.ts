// lib/admin/llm-brreg-tier1.ts — Tier 1 (AI-relevance + AI-phrase
// extraction) for brreg companies.
//
// Mirrors lib/admin/llm-media-tier1.ts but operates on brreg_companies
// (PK = orgnr, text). Per D7 of the symmetric-triggers PRD: the haystack
// is `aktivitet` only — company names are too short and proper-noun
// heavy to extract useful AI-related phrases from. Validation is the
// shared substring-match in llm-media-parse.validatePhrases.
//
// Active prompt loaded from public.llm_prompts (role='brreg_tier1').
// Same concurrency / heartbeat / retry semantics as the media + NAV
// orchestrators.

import "server-only";

import { sbFetch } from "@/lib/admin/sb";
import { mlxChat, mlxConfigured, MlxError } from "@/lib/admin/mlx";
import { loadActivePrompt } from "@/lib/admin/llm-prompts";
import { parseTier1, validatePhrases } from "@/lib/admin/llm-brreg-parse";

const JOB_NAME = "brreg_llm_tier1";
const MODEL_VERSION = "gemma-3-4b-it-4bit";

const DEFAULT_K_PER_TICK = 15;
const DEFAULT_WALL_TIME_MS = 60_000;
const HEARTBEAT_STALE_MS = 5 * 60 * 1000;
const RETRY_LIMIT = 3;

const TIER1_MODEL_MAX_TOKENS = 400;
const TIER1_MODEL_TEMPERATURE = 0.2;

type Sb = typeof sbFetch;
type Trigger = "manual" | "cron";

type Company = {
  orgnr: string;
  aktivitet: string | null;
};

export type RunBrregTier1Result = {
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

export async function runBrregTier1(args: {
  sb: Sb;
  trigger: Trigger;
  k?: number;
  wallTimeMs?: number;
}): Promise<RunBrregTier1Result> {
  const {
    sb,
    trigger,
    k = DEFAULT_K_PER_TICK,
    wallTimeMs = DEFAULT_WALL_TIME_MS,
  } = args;

  if (!mlxConfigured()) {
    return { status: "skipped", reason: "no_api_key" };
  }
  if (await isRunning(sb)) {
    return { status: "skipped", reason: "already_running" };
  }
  const prompt = await loadActivePrompt(sb, "brreg_tier1");
  if (!prompt) {
    return { status: "skipped", reason: "no_prompt" };
  }

  const candidates = await sb<Company[]>(
    `/brreg_companies?is_ai_relevant=is.true&tier1_completed_at=is.null` +
      `&llm_retry_count=lt.${RETRY_LIMIT}` +
      `&ingest_mode=eq.live` +
      `&select=orgnr,aktivitet&order=registrert_dato.desc&limit=${k}`,
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
    const meta = {
      processed: 0,
      ai_relevant: 0,
      phrases_persisted: 0,
      parse_fails: 0,
      http_fails: 0,
      auth_fails: 0,
      stopped: "queue_empty",
    };
    await finalize(sb, job.id, "success", meta);
    return { status: "success", job_id: job.id, metadata: meta };
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
      if (Date.now() - start > wallTimeMs) {
        stopped = "wall_time";
        break;
      }
      const company = candidates[idx];
      try {
        const r = await processOne(sb, company, prompt.body, prompt.id);
        processed += 1;
        if (r.aiRelevant) aiRelevant += 1;
        phrasesPersisted += r.phraseCount;
      } catch (err) {
        if (err instanceof MlxError && err.kind === "auth") {
          authFails += 1;
          await markFailed(sb, company.orgnr, false);
          stopped = "auth_failed";
          break;
        }
        if (err instanceof MlxError && err.kind === "parse") {
          parseFails += 1;
          await markFailed(sb, company.orgnr, true);
        } else {
          httpFails += 1;
          await markFailed(sb, company.orgnr, true);
        }
      }
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
  company: Company,
  systemPrompt: string,
  promptId: string,
): Promise<{ aiRelevant: boolean; phraseCount: number }> {
  const aktivitet = company.aktivitet ?? "";
  const userInput = `Aktivitet: ${aktivitet}`;

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
      `brreg_tier1 output not valid JSON: ${resp.content.slice(0, 200)}`,
    );
  }

  const validatedPhrases = validatePhrases(parsed.phrases, aktivitet);
  const persisted = {
    ai_relevant: parsed.ai_relevant,
    phrases: validatedPhrases,
    phrases_returned: parsed.phrases.length,
    prompt_id: promptId,
    model_version: MODEL_VERSION,
  };

  await sb(`/brreg_companies?orgnr=eq.${encodeURIComponent(company.orgnr)}`, {
    service: true,
    method: "PATCH",
    body: {
      llm_ai_phrases: persisted,
      tier1_completed_at: new Date().toISOString(),
    },
    prefer: "return=minimal",
  });

  return {
    aiRelevant: parsed.ai_relevant,
    phraseCount: validatedPhrases.length,
  };
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

async function markFailed(
  sb: Sb,
  orgnr: string,
  bumpRetry: boolean,
): Promise<void> {
  try {
    let nextRetry: number | undefined;
    if (bumpRetry) {
      const rows = await sb<{ llm_retry_count: number | null }[]>(
        `/brreg_companies?orgnr=eq.${encodeURIComponent(orgnr)}` +
          `&select=llm_retry_count`,
        { service: true },
      );
      const current = rows[0]?.llm_retry_count ?? 0;
      nextRetry = current + 1;
    }
    const body: Record<string, unknown> = {};
    if (typeof nextRetry === "number") body.llm_retry_count = nextRetry;
    if (Object.keys(body).length === 0) return;
    await sb(`/brreg_companies?orgnr=eq.${encodeURIComponent(orgnr)}`, {
      service: true,
      method: "PATCH",
      body,
      prefer: "return=minimal",
    });
  } catch (err) {
    console.error(
      `brreg_tier1 markFailed ${orgnr}: ${err instanceof Error ? err.message : String(err)}`,
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
      `brreg_tier1 heartbeat ${jobId} (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
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
    rows_processed:
      typeof metadata.processed === "number" ? metadata.processed : 0,
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
