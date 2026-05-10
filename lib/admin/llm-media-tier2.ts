// lib/admin/llm-media-tier2.ts — Tier 2 (taxonomy + stance + intensity) for media.
//
// Mirrors lib/admin/llm-classify.ts but operates on media_articles, uses
// public.media_categories for the {{categories_block}}, and additionally
// validates stance against the fixed 6-value enum and clamps intensity to
// [0, 1]. Stance values are intentionally NOT operator-editable — keeping
// the enum stable is what makes the Kibarometer Index time-series
// comparable across prompt revisions.
//
// Tier 2 only sees the headline (no body persistence) plus the verbatim
// AI phrases from Tier 1. K=4 per tick, ~12 s/call.

import "server-only";

import { sbFetch } from "@/lib/admin/sb";
import { mlxChat, mlxConfigured, MlxError } from "@/lib/admin/mlx";
import { loadActivePrompt } from "@/lib/admin/llm-prompts";
import {
  parseTier2,
  clampUnit,
  STANCE_SET,
  STANCE_VALUES,
  type Stance,
  type CategoryAssignment,
} from "@/lib/admin/llm-media-parse";

export { STANCE_VALUES };

const JOB_NAME = "media_llm_tier2";
const MODEL_VERSION = "gemma-3-4b-it-4bit";
const TAXONOMY_VERSION = "v1";

const DEFAULT_K_PER_TICK = 4;
const DEFAULT_WALL_TIME_MS = 60_000;
const HEARTBEAT_STALE_MS = 5 * 60 * 1000;
const RETRY_LIMIT = 3;

const MAX_CATEGORIES_PER_ARTICLE = 3;
const MAX_RATIONALE_CHARS = 400;

const TIER2_MODEL_MAX_TOKENS = 600;
const TIER2_MODEL_TEMPERATURE = 0.2;

type Sb = typeof sbFetch;
type Trigger = "manual" | "cron";

type Article = {
  id: string;
  headline: string | null;
  llm_ai_phrases: { phrases?: { text?: string }[] } | null;
};

type CategoryRow = {
  slug: string;
  label_no: string;
  description: string | null;
};

export type RunMediaTier2Result = {
  status: "success" | "skipped";
  reason?: "no_api_key" | "already_running" | "no_taxonomy";
  job_id?: string;
  metadata?: {
    processed: number;
    parse_fails: number;
    invalid_slug_drops: number;
    invalid_stance_drops: number;
    http_fails: number;
    auth_fails: number;
    stopped: string;
  };
};

export async function runMediaTier2(args: {
  sb: Sb;
  trigger: Trigger;
  k?: number;
  wallTimeMs?: number;
}): Promise<RunMediaTier2Result> {
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
    loadActivePrompt(sb, "media_tier2"),
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

  // Tier 2 gates on the keyword-driven `is_ai_related=true` directly,
  // not on `tier1_completed_at`. Decoupling from Tier 1 lets Tier 2
  // categorize historical rows (ingest_mode='backfill') that Tier 1
  // never visits — Tier 1 is forward-only on live ingest, while
  // categorization needs to fill in history.
  const candidates = await sb<Article[]>(
    `/media_articles?is_ai_related=is.true&tier2_completed_at=is.null` +
      `&deleted_at=is.null&llm_retry_count=lt.${RETRY_LIMIT}` +
      `&select=id,headline,llm_ai_phrases&order=created_at.desc&limit=${k}`,
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
      invalid_stance_drops: 0,
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
  let invalidStanceDrops = 0;
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
        const r = await processOne(
          sb,
          article,
          systemPrompt,
          prompt.id,
          validSlugs,
        );
        processed += 1;
        invalidSlugDrops += r.invalidSlugDrops;
        if (r.stanceDropped) invalidStanceDrops += 1;
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
      invalid_stance_drops: invalidStanceDrops,
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
      invalid_stance_drops: invalidStanceDrops,
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
  validSlugs: Set<string>,
): Promise<{ invalidSlugDrops: number; stanceDropped: boolean }> {
  const headline = article.headline ?? "";
  const phraseList = (article.llm_ai_phrases?.phrases ?? [])
    .map((p) => p?.text)
    .filter((t): t is string => typeof t === "string" && t.length > 0)
    .slice(0, 12);
  const phrasesLine = phraseList.length
    ? `\n\nAI-fraser fra Tier 1: ${phraseList.join(", ")}`
    : "";
  const userInput = `Overskrift: ${headline}${phrasesLine}`;

  const resp = await mlxChat({
    system: systemPrompt,
    user: userInput,
    maxTokens: TIER2_MODEL_MAX_TOKENS,
    temperature: TIER2_MODEL_TEMPERATURE,
  });

  const parsed = parseTier2(resp.content);
  if (!parsed) {
    throw new MlxError(
      "parse",
      `media_tier2 output not valid JSON: ${resp.content.slice(0, 200)}`,
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
    if (accepted.length >= MAX_CATEGORIES_PER_ARTICLE) break;
  }

  // Stance: keep only if it's one of the 6 allowed values. Drop to null
  // otherwise — temperature averaging treats null as excluded rather than
  // forcing a wrong bucket.
  const stance: Stance | null =
    parsed.stance && STANCE_SET.has(parsed.stance) ? parsed.stance : null;
  const stanceDropped = parsed.stance != null && stance == null;

  const intensity =
    parsed.intensity == null ? null : clampUnit(parsed.intensity);

  const persisted = {
    categories: accepted,
    stance,
    intensity,
    rationale: parsed.rationale.slice(0, MAX_RATIONALE_CHARS),
    invalid_slugs_dropped: invalidSlugDrops,
    invalid_stance_dropped: stanceDropped,
  };

  await sb(`/media_articles?id=eq.${encodeURIComponent(article.id)}`, {
    service: true,
    method: "PATCH",
    body: {
      llm_categories: persisted,
      llm_stance: stance,
      llm_intensity: intensity,
      tier2_completed_at: new Date().toISOString(),
      llm_taxonomy_version: TAXONOMY_VERSION,
      llm_prompt_id: promptId,
      llm_model_version: MODEL_VERSION,
    },
    prefer: "return=minimal",
  });

  return { invalidSlugDrops, stanceDropped };
}

function buildCategoriesBlock(taxonomy: CategoryRow[]): string {
  return taxonomy
    .map((t) => {
      const def = (t.description ?? "").trim();
      return def
        ? `- \`${t.slug}\` — ${t.label_no}: ${def}`
        : `- \`${t.slug}\` — ${t.label_no}`;
    })
    .join("\n");
}

async function loadLiveTaxonomy(sb: Sb): Promise<CategoryRow[]> {
  return sb<CategoryRow[]>(
    "/media_categories?is_active=is.true" +
      "&select=slug,label_no,description&order=slug.asc",
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
      `media_tier2 markFailed ${articleId}: ${err instanceof Error ? err.message : String(err)}`,
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
      `media_tier2 heartbeat ${jobId} (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
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
