// lib/admin/llm-media-tier1.ts — Tier 1 (AI-relevance confirmation) for media.
//
// Mirrors lib/admin/llm-discover.ts but operates on media_articles instead
// of nav_postings, and only sees `headline` (no body is ever persisted —
// see CLAUDE.md and PRD §"What gets stored vs discarded"). Verbatim
// phrase validation runs against the headline alone, which is enough to
// catch hallucinations on the rare row where the model invents text.
//
// Active prompt loaded from public.llm_prompts (role='media_tier1'). Same
// concurrency / heartbeat / retry semantics as llm-discover.

import "server-only";

import { sbFetch } from "@/lib/admin/sb";
import { mlxChat, mlxConfigured, MlxError } from "@/lib/admin/mlx";
import { loadActivePrompt } from "@/lib/admin/llm-prompts";
import { parseTier1, validatePhrases } from "@/lib/admin/llm-media-parse";

const JOB_NAME = "media_llm_tier1";
const MODEL_VERSION = "gemma-3-4b-it-4bit";

const DEFAULT_K_PER_TICK = 15;
const DEFAULT_WALL_TIME_MS = 60_000;
const HEARTBEAT_STALE_MS = 5 * 60 * 1000;
const RETRY_LIMIT = 3;

const TIER1_MODEL_MAX_TOKENS = 400;
const TIER1_MODEL_TEMPERATURE = 0.2;

type Sb = typeof sbFetch;
type Trigger = "manual" | "cron";

type Article = {
  id: string;
  headline: string | null;
};

export type RunMediaTier1Result = {
  status: "success" | "skipped";
  reason?: "no_api_key" | "already_running" | "no_prompt";
  job_id?: string;
  metadata?: {
    processed: number;
    phrases_persisted: number;
    parse_fails: number;
    http_fails: number;
    auth_fails: number;
    stopped: string;
  };
};

export async function runMediaTier1(args: {
  sb: Sb;
  trigger: Trigger;
  k?: number;
  wallTimeMs?: number;
}): Promise<RunMediaTier1Result> {
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
  const prompt = await loadActivePrompt(sb, "media_tier1");
  if (!prompt) {
    return { status: "skipped", reason: "no_prompt" };
  }

  const candidates = await sb<Article[]>(
    `/media_articles?is_ai_related=is.true&tier1_completed_at=is.null` +
      `&deleted_at=is.null&llm_retry_count=lt.${RETRY_LIMIT}` +
      `&ingest_mode=eq.live` +
      `&select=id,headline` +
      `&order=published_at.desc.nullslast,created_at.desc&limit=${k}`,
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
      const article = candidates[idx];
      try {
        const r = await processOne(sb, article, prompt.body, prompt.id);
        processed += 1;
        phrasesPersisted += r.phraseCount;
      } catch (err) {
        if (err instanceof MlxError && err.kind === "auth") {
          authFails += 1;
          await markFailed(sb, article.id, false);
          stopped = "auth_failed";
          break;
        }
        if (err instanceof MlxError && err.kind === "parse") {
          parseFails += 1;
          await markFailed(sb, article.id, true);
        } else {
          httpFails += 1;
          await markFailed(sb, article.id, true);
        }
      }
      if ((idx + 1) % 3 === 0 || idx === candidates.length - 1) {
        await heartbeat(sb, job.id, {
          pct: ((idx + 1) / candidates.length) * 100,
          step:
            `${idx + 1} / ${candidates.length} · ${processed} ok · ` +
            `${phrasesPersisted} fraser · ${parseFails + httpFails + authFails} feil`,
        });
      }
    }

    const meta = {
      processed,
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
  article: Article,
  systemPrompt: string,
  promptId: string,
): Promise<{ phraseCount: number }> {
  const headline = article.headline ?? "";
  const userInput = `Overskrift: ${headline}`;

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
      `media_tier1 output not valid JSON: ${resp.content.slice(0, 200)}`,
    );
  }

  const validatedPhrases = validatePhrases(parsed.phrases, headline);
  const persisted = {
    phrases: validatedPhrases,
    phrases_returned: parsed.phrases.length,
  };

  await sb(`/media_articles?id=eq.${encodeURIComponent(article.id)}`, {
    service: true,
    method: "PATCH",
    body: {
      llm_ai_phrases: persisted,
      tier1_completed_at: new Date().toISOString(),
      llm_prompt_id: promptId,
      llm_model_version: MODEL_VERSION,
    },
    prefer: "return=minimal",
  });

  return {
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
  articleId: string,
  bumpRetry: boolean,
): Promise<void> {
  try {
    let nextRetry: number | undefined;
    if (bumpRetry) {
      const rows = await sb<{ llm_retry_count: number | null }[]>(
        `/media_articles?id=eq.${encodeURIComponent(articleId)}` +
          `&select=llm_retry_count`,
        { service: true },
      );
      const current = rows[0]?.llm_retry_count ?? 0;
      nextRetry = current + 1;
    }
    const body: Record<string, unknown> = {};
    if (typeof nextRetry === "number") body.llm_retry_count = nextRetry;
    if (Object.keys(body).length === 0) return;
    await sb(`/media_articles?id=eq.${encodeURIComponent(articleId)}`, {
      service: true,
      method: "PATCH",
      body,
      prefer: "return=minimal",
    });
  } catch (err) {
    console.error(
      `media_tier1 markFailed ${articleId}: ${err instanceof Error ? err.message : String(err)}`,
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
      `media_tier1 heartbeat ${jobId} (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
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
