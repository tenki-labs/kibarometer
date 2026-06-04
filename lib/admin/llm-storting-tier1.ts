// lib/admin/llm-storting-tier1.ts — Tier 1 (verbatim AI-phrase extraction)
// for Stortinget saker.
//
// Mirrors lib/admin/llm-brreg-tier1.ts. The haystack is the sak's tittel +
// korttittel + flattened emne_liste names — short, formal parliamentary
// language. Phrases are validated against the haystack via the shared
// substring-match in llm-offentlig-parse.validatePhrases.
//
// AI-relevance is decided by the keyword matcher at ingest time
// (is_ai_relevant generated from has_ai_in_title OR has_ai_in_emner).
// Tier 1 only enriches already-flagged rows for keyword-catalog growth —
// it does NOT re-validate relevance.
//
// Active prompt loaded from public.llm_prompts (role='offentlig_storting_tier1').
// Same concurrency / heartbeat / retry semantics as the media + NAV + brreg
// orchestrators.

import "server-only";

import { sbFetch } from "@/lib/admin/sb";
import { mlxChat, mlxConfigured, MlxError } from "@/lib/admin/mlx";
import { isTransientMlxFailure } from "./llm-failure";
import { loadActivePrompt } from "@/lib/admin/llm-prompts";
import { parseTier1, validatePhrases } from "@/lib/admin/llm-offentlig-parse";

const JOB_NAME = "storting_llm_tier1";
const MODEL_VERSION = "gemma-3-4b-it-4bit";

const DEFAULT_K_PER_TICK = 15;
const DEFAULT_WALL_TIME_MS = 60_000;
const HEARTBEAT_STALE_MS = 5 * 60 * 1000;
const RETRY_LIMIT = 3;

const TIER1_MODEL_MAX_TOKENS = 400;
const TIER1_MODEL_TEMPERATURE = 0.2;

type Sb = typeof sbFetch;
type Trigger = "manual" | "cron";

type Sak = {
  sak_id: number;
  tittel: string | null;
  korttittel: string | null;
  emne_liste: unknown;
};

export type RunStortingTier1Result = {
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

export async function runStortingTier1(args: {
  sb: Sb;
  trigger: Trigger;
  k?: number;
  wallTimeMs?: number;
}): Promise<RunStortingTier1Result> {
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
  const prompt = await loadActivePrompt(sb, "offentlig_storting_tier1");
  if (!prompt) {
    return { status: "skipped", reason: "no_prompt" };
  }

  const candidates = await sb<Sak[]>(
    `/storting_saker?is_ai_relevant=is.true&tier1_completed_at=is.null` +
      `&llm_retry_count=lt.${RETRY_LIMIT}` +
      `&ingest_mode=eq.live` +
      `&select=sak_id,tittel,korttittel,emne_liste` +
      `&order=ingested_at.desc&limit=${k}`,
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
      const sak = candidates[idx];
      try {
        const r = await processOne(sb, sak, prompt.body, prompt.id);
        processed += 1;
        phrasesPersisted += r.phraseCount;
      } catch (err) {
        if (err instanceof MlxError && err.kind === "auth") {
          authFails += 1;
          await markFailed(sb, sak.sak_id, false);
          stopped = "auth_failed";
          break;
        }
        if (err instanceof MlxError && err.kind === "parse") {
          parseFails += 1;
          await markFailed(sb, sak.sak_id, true);
        } else {
          httpFails += 1;
          // Transient infra failures (502 / unreachable) must not consume the
          // permanent retry budget — see lib/admin/llm-failure.ts.
          await markFailed(sb, sak.sak_id, !isTransientMlxFailure(err));
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

// Builds the matching haystack used by validatePhrases — must mirror the
// keyword-matcher haystack from storting-processor.js so a phrase the LLM
// quoted is checked against the same surface text the keyword tagger sees.
function buildHaystack(sak: Sak): string {
  const titlePart = [sak.tittel ?? "", sak.korttittel ?? ""]
    .filter((s) => typeof s === "string" && s.length > 0)
    .join(" ");

  const emnerPart = flattenEmner(sak.emne_liste).join(" ");
  return [titlePart, emnerPart].filter(Boolean).join(" ");
}

function flattenEmner(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const e of raw) {
    if (e && typeof e === "object") {
      const navn = (e as { navn?: unknown }).navn;
      if (typeof navn === "string" && navn.length > 0) out.push(navn);
      const under = (e as { underemne_liste?: unknown }).underemne_liste;
      if (Array.isArray(under)) {
        for (const u of under) {
          if (u && typeof u === "object") {
            const un = (u as { navn?: unknown }).navn;
            if (typeof un === "string" && un.length > 0) out.push(un);
          }
        }
      }
    }
  }
  return out;
}

async function processOne(
  sb: Sb,
  sak: Sak,
  systemPrompt: string,
  promptId: string,
): Promise<{ phraseCount: number }> {
  const haystack = buildHaystack(sak);
  const emnerLine = flattenEmner(sak.emne_liste);
  const userInput =
    `Sak: ${sak.tittel ?? ""}\n` +
    (sak.korttittel ? `Korttittel: ${sak.korttittel}\n` : "") +
    `Emner: [${emnerLine.join(", ")}]`;

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
      `offentlig_storting_tier1 output not valid JSON: ${resp.content.slice(0, 200)}`,
    );
  }

  const validatedPhrases = validatePhrases(parsed.phrases, haystack);
  const persisted = {
    phrases: validatedPhrases,
    phrases_returned: parsed.phrases.length,
    prompt_id: promptId,
    model_version: MODEL_VERSION,
  };

  await sb(`/storting_saker?sak_id=eq.${sak.sak_id}`, {
    service: true,
    method: "PATCH",
    body: {
      llm_ai_phrases: persisted,
      tier1_completed_at: new Date().toISOString(),
    },
    prefer: "return=minimal",
  });

  return { phraseCount: validatedPhrases.length };
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
  sakId: number,
  bumpRetry: boolean,
): Promise<void> {
  try {
    let nextRetry: number | undefined;
    if (bumpRetry) {
      const rows = await sb<{ llm_retry_count: number | null }[]>(
        `/storting_saker?sak_id=eq.${sakId}` + `&select=llm_retry_count`,
        { service: true },
      );
      const current = rows[0]?.llm_retry_count ?? 0;
      nextRetry = current + 1;
    }
    const body: Record<string, unknown> = {};
    if (typeof nextRetry === "number") body.llm_retry_count = nextRetry;
    if (Object.keys(body).length === 0) return;
    await sb(`/storting_saker?sak_id=eq.${sakId}`, {
      service: true,
      method: "PATCH",
      body,
      prefer: "return=minimal",
    });
  } catch (err) {
    console.error(
      `storting_tier1 markFailed ${sakId}: ${err instanceof Error ? err.message : String(err)}`,
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
      `storting_tier1 heartbeat ${jobId} (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
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
