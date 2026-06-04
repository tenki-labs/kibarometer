// lib/admin/llm-storting-tier2.ts — Tier 2 (taxonomy slug assignment) for
// Stortinget saker.
//
// Mirrors lib/admin/llm-brreg-tier2.ts. Loads slugs from
// public.storting_categories, no stance/intensity scoring (parliamentary
// saker don't carry editorial stance the way news articles do).
//
// Tier 2 gates on is_ai_relevant directly, not on tier1_completed_at, so
// historical (ingest_mode='backfill') rows that Tier 1 never visits can
// still be categorized.
//
// Tier 2 sees the sak tittel + flattened emne_liste names + the verbatim
// AI phrases from Tier 1 (when available). K=4 per tick, ~12 s/call.

import "server-only";

import { sbFetch } from "@/lib/admin/sb";
import { mlxChat, mlxConfigured, MlxError } from "@/lib/admin/mlx";
import { isTransientMlxFailure } from "./llm-failure";
import { loadActivePrompt } from "@/lib/admin/llm-prompts";
import {
  parseOffentligTier2,
  clampUnit,
  type CategoryAssignment,
} from "@/lib/admin/llm-offentlig-parse";

const JOB_NAME = "storting_llm_tier2";
const MODEL_VERSION = "gemma-3-4b-it-4bit";
export const STORTING_TAXONOMY_VERSION = "v1";
const TAXONOMY_VERSION = STORTING_TAXONOMY_VERSION;

const DEFAULT_K_PER_TICK = 4;
const DEFAULT_WALL_TIME_MS = 60_000;
const HEARTBEAT_STALE_MS = 5 * 60 * 1000;
const RETRY_LIMIT = 3;

const MAX_CATEGORIES_PER_SAK = 3;

const TIER2_MODEL_MAX_TOKENS = 600;
const TIER2_MODEL_TEMPERATURE = 0.2;

type Sb = typeof sbFetch;
type Trigger = "manual" | "cron";

type Sak = {
  sak_id: number;
  tittel: string | null;
  korttittel: string | null;
  emne_liste: unknown;
  llm_ai_phrases: { phrases?: { text?: string }[] } | null;
};

type CategoryRow = {
  slug: string;
  label_no: string;
};

export type RunStortingTier2Result = {
  status: "success" | "skipped";
  reason?: "no_api_key" | "already_running" | "no_taxonomy";
  job_id?: string;
  metadata?: {
    processed: number;
    parse_fails: number;
    invalid_slug_drops: number;
    http_fails: number;
    auth_fails: number;
    stopped: string;
  };
};

export async function runStortingTier2(args: {
  sb: Sb;
  trigger: Trigger;
  k?: number;
  wallTimeMs?: number;
}): Promise<RunStortingTier2Result> {
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

  const [prompt, taxonomy] = await Promise.all([
    loadActivePrompt(sb, "offentlig_storting_tier2"),
    loadLiveTaxonomy(sb),
  ]);
  if (!prompt || taxonomy.length === 0) {
    return { status: "skipped", reason: "no_taxonomy" };
  }

  const validSlugs = new Set(taxonomy.map((t) => t.slug));
  const systemPrompt = prompt.body.replace(
    "{{categories_block}}",
    buildCategoriesBlock(taxonomy),
  );

  const candidates = await sb<Sak[]>(
    `/storting_saker?is_ai_relevant=is.true&tier2_completed_at=is.null` +
      `&llm_retry_count=lt.${RETRY_LIMIT}` +
      `&select=sak_id,tittel,korttittel,emne_liste,llm_ai_phrases` +
      `&order=ingested_at.desc&limit=${k}`,
    { service: true },
  );

  const [job] = await sb<{ id: string }[]>(`/jobs`, {
    service: true,
    method: "POST",
    body: {
      name: JOB_NAME,
      trigger,
      metadata: {
        candidates: candidates.length,
        taxonomy_version: TAXONOMY_VERSION,
        prompt_id: prompt.id,
      },
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
      parse_fails: 0,
      invalid_slug_drops: 0,
      http_fails: 0,
      auth_fails: 0,
      stopped: "queue_empty",
    };
    await finalize(sb, job.id, "success", meta);
    return { status: "success", job_id: job.id, metadata: meta };
  }

  const start = Date.now();
  let processed = 0;
  let parseFails = 0;
  let invalidSlugDrops = 0;
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
        const r = await processOne(sb, sak, systemPrompt, prompt.id, validSlugs);
        processed += 1;
        invalidSlugDrops += r.invalidSlugDrops;
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
      await heartbeat(sb, job.id, {
        pct: ((idx + 1) / candidates.length) * 100,
        step:
          `${idx + 1} / ${candidates.length} · ${processed} ok · ` +
          `${parseFails + httpFails + authFails} feil`,
      });
    }

    const meta = {
      processed,
      parse_fails: parseFails,
      invalid_slug_drops: invalidSlugDrops,
      http_fails: httpFails,
      auth_fails: authFails,
      stopped,
    };
    await finalize(sb, job.id, "success", meta);
    return { status: "success", job_id: job.id, metadata: meta };
  } catch (err) {
    await finalize(sb, job.id, "failed", {
      processed,
      parse_fails: parseFails,
      invalid_slug_drops: invalidSlugDrops,
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
  sak: Sak,
  systemPrompt: string,
  promptId: string,
  validSlugs: Set<string>,
): Promise<{ invalidSlugDrops: number }> {
  const tittel = sak.tittel ?? "";
  const korttittel = sak.korttittel ?? "";
  const emnerLine = flattenEmner(sak.emne_liste);

  const phraseList = (sak.llm_ai_phrases?.phrases ?? [])
    .map((p) => p?.text)
    .filter((t): t is string => typeof t === "string" && t.length > 0)
    .slice(0, 8);
  const phrasesLine = phraseList.length
    ? `\n\nAI-fraser fra Tier 1: ${phraseList.join(", ")}`
    : "";

  const userInput =
    `Sak: ${tittel}\n` +
    (korttittel ? `Korttittel: ${korttittel}\n` : "") +
    `Emner: [${emnerLine.join(", ")}]${phrasesLine}`;

  const resp = await mlxChat({
    system: systemPrompt,
    user: userInput,
    maxTokens: TIER2_MODEL_MAX_TOKENS,
    temperature: TIER2_MODEL_TEMPERATURE,
  });

  const parsed = parseOffentligTier2(resp.content);
  if (!parsed) {
    throw new MlxError(
      "parse",
      `offentlig_storting_tier2 output not valid JSON: ${resp.content.slice(0, 200)}`,
    );
  }

  const accepted: CategoryAssignment[] = [];
  let invalidSlugDrops = 0;
  for (const c of parsed.categories) {
    if (!validSlugs.has(c.slug)) {
      invalidSlugDrops += 1;
      continue;
    }
    accepted.push({
      slug: c.slug,
      confidence: clampUnit(c.confidence),
    });
    if (accepted.length >= MAX_CATEGORIES_PER_SAK) break;
  }

  // llm_categories holds the entire Tier 2 output as a single JSONB blob —
  // snapshot SQL unnests `llm_categories->'categories'` for per-slug counts.
  // Rationale + invalid-slug-drops travel inside the same blob (admin oracle
  // queue reads them); per-metadata columns (taxonomy_version / prompt_id /
  // model_version) stay separate so they're queryable without JSON ops.
  const persisted = {
    categories: accepted,
    rationale: parsed.rationale,
    invalid_slugs_dropped: invalidSlugDrops,
  };

  await sb(`/storting_saker?sak_id=eq.${sak.sak_id}`, {
    service: true,
    method: "PATCH",
    body: {
      llm_categories: persisted,
      tier2_completed_at: new Date().toISOString(),
      llm_taxonomy_version: TAXONOMY_VERSION,
      llm_prompt_id: promptId,
      llm_model_version: MODEL_VERSION,
    },
    prefer: "return=minimal",
  });

  return { invalidSlugDrops };
}

function flattenEmner(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const e of raw) {
    if (e && typeof e === "object") {
      const navn = (e as { navn?: unknown }).navn;
      if (typeof navn === "string" && navn.length > 0) out.push(navn);
    }
  }
  return out;
}

function buildCategoriesBlock(taxonomy: CategoryRow[]): string {
  return taxonomy
    .map((t) => `- \`${t.slug}\` — ${t.label_no}`)
    .join("\n");
}

async function loadLiveTaxonomy(sb: Sb): Promise<CategoryRow[]> {
  return sb<CategoryRow[]>(
    "/storting_categories?is_active=is.true" +
      "&select=slug,label_no&order=sort_order.asc,slug.asc",
    { service: true },
  );
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
      `storting_tier2 markFailed ${sakId}: ${err instanceof Error ? err.message : String(err)}`,
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
      `storting_tier2 heartbeat ${jobId} (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
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
