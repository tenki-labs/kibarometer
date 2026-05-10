// lib/admin/llm-brreg-tier2.ts — Tier 2 (taxonomy) for brreg companies.
//
// Mirrors lib/admin/llm-media-tier2.ts but operates on brreg_companies,
// loads the taxonomy from public.brreg_categories, and returns just
// {categories, rationale} — no stance/intensity, since companies don't
// carry an editorial stance the way articles do.
//
// Tier 2 sees the company's `aktivitet` plus the verbatim AI phrases
// from Tier 1. K=4 per tick, ~12 s/call.

import "server-only";

import { sbFetch } from "@/lib/admin/sb";
import { mlxChat, mlxConfigured, MlxError } from "@/lib/admin/mlx";
import { loadActivePrompt } from "@/lib/admin/llm-prompts";
import {
  parseBrregTier2,
  clampUnit,
  type CategoryAssignment,
} from "@/lib/admin/llm-brreg-parse";

const JOB_NAME = "brreg_llm_tier2";
const MODEL_VERSION = "gemma-3-4b-it-4bit";
export const BRREG_TAXONOMY_VERSION = "v1";
const TAXONOMY_VERSION = BRREG_TAXONOMY_VERSION;

const DEFAULT_K_PER_TICK = 4;
const DEFAULT_WALL_TIME_MS = 60_000;
const HEARTBEAT_STALE_MS = 5 * 60 * 1000;
const RETRY_LIMIT = 3;

const MAX_CATEGORIES_PER_COMPANY = 3;

const TIER2_MODEL_MAX_TOKENS = 600;
const TIER2_MODEL_TEMPERATURE = 0.2;

export type Sb = typeof sbFetch;
type Trigger = "manual" | "cron";

export type Company = {
  orgnr: string;
  aktivitet: string | null;
  llm_ai_phrases: { phrases?: { text?: string }[] } | null;
};

export type CategoryRow = {
  slug: string;
  label_no: string;
  description: string | null;
};

export type RunBrregTier2Result = {
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

export async function runBrregTier2(args: {
  sb: Sb;
  trigger: Trigger;
  k?: number;
  wallTimeMs?: number;
}): Promise<RunBrregTier2Result> {
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
    loadActivePrompt(sb, "brreg_tier2"),
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

  // Tier 2 gates on the keyword-driven `is_ai_relevant=true` directly,
  // not on `tier1_completed_at`. Decoupling from Tier 1 lets Tier 2
  // categorize historical companies that Tier 1 never visited (Tier 1
  // is forward-only on `ingest_mode='live'`).
  const candidates = await sb<Company[]>(
    `/brreg_companies?is_ai_relevant=is.true&tier2_completed_at=is.null` +
      `&llm_retry_count=lt.${RETRY_LIMIT}` +
      `&select=orgnr,aktivitet,llm_ai_phrases` +
      `&order=registrert_dato.desc&limit=${k}`,
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
      const company = candidates[idx];
      try {
        const r = await processOne(
          sb,
          company,
          systemPrompt,
          prompt.id,
          validSlugs,
        );
        processed += 1;
        invalidSlugDrops += r.invalidSlugDrops;
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
  company: Company,
  systemPrompt: string,
  promptId: string,
  validSlugs: Set<string>,
): Promise<{ invalidSlugDrops: number }> {
  const aktivitet = company.aktivitet ?? "";
  const phraseList = (company.llm_ai_phrases?.phrases ?? [])
    .map((p) => p?.text)
    .filter((t): t is string => typeof t === "string" && t.length > 0)
    .slice(0, 8);
  const phrasesLine = phraseList.length
    ? `\n\nAI-fraser fra Tier 1: ${phraseList.join(", ")}`
    : "";
  const userInput = `Aktivitet: ${aktivitet}${phrasesLine}`;

  const resp = await mlxChat({
    system: systemPrompt,
    user: userInput,
    maxTokens: TIER2_MODEL_MAX_TOKENS,
    temperature: TIER2_MODEL_TEMPERATURE,
  });

  const parsed = parseBrregTier2(resp.content);
  if (!parsed) {
    throw new MlxError(
      "parse",
      `brreg_tier2 output not valid JSON: ${resp.content.slice(0, 200)}`,
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
    if (accepted.length >= MAX_CATEGORIES_PER_COMPANY) break;
  }

  const persisted = {
    categories: accepted,
    invalid_slugs_dropped: invalidSlugDrops,
    taxonomy_version: TAXONOMY_VERSION,
    prompt_id: promptId,
    model_version: MODEL_VERSION,
  };

  await sb(`/brreg_companies?orgnr=eq.${encodeURIComponent(company.orgnr)}`, {
    service: true,
    method: "PATCH",
    body: {
      tier2_categories: persisted,
      tier2_rationale: parsed.rationale,
      tier2_completed_at: new Date().toISOString(),
    },
    prefer: "return=minimal",
  });

  return { invalidSlugDrops };
}

export function buildCategoriesBlock(taxonomy: CategoryRow[]): string {
  return taxonomy
    .map((t) => {
      const def = (t.description ?? "").trim();
      return def
        ? `- \`${t.slug}\` — ${t.label_no}: ${def}`
        : `- \`${t.slug}\` — ${t.label_no}`;
    })
    .join("\n");
}

export async function loadLiveTaxonomy(sb: Sb): Promise<CategoryRow[]> {
  return sb<CategoryRow[]>(
    "/brreg_categories?is_active=is.true" +
      "&select=slug,label_no,description&order=sort_order.asc,slug.asc",
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
      `brreg_tier2 markFailed ${orgnr}: ${err instanceof Error ? err.message : String(err)}`,
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
      `brreg_tier2 heartbeat ${jobId} (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
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
