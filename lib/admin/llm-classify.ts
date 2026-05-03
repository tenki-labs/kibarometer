// lib/admin/llm-classify.ts — Tier 2 (classification) orchestrator.
//
// Picks up to K rows from nav_postings where is_ai=true and tier2_completed_at
// is null and llm_retry_count < 3. Calls mlx.tenki.no with the active Tier 2
// prompt (taxonomy block rendered at runtime from public.taxonomy_categories).
// Validates returned slugs against the live taxonomy. Persists categories +
// rationale + version stamp + prompt id.
//
// Bootstrap guards: returns {skipped: 'no_taxonomy'} if either the active
// tier2 prompt or the live taxonomy is missing. /admin/llm surfaces this
// in PR 5 so the operator knows what's blocking classification.
//
// K=4 per tick (vs Tier 1's 15) because Tier 2 sends the full description
// + full taxonomy + rationale in/out — ~12 s/call on Gemma 4B 4-bit instead
// of ~3 s, so the same 60 s wall budget covers fewer rows.
//
// Concurrency / sweep: same pattern as llm-discover. llm_classify is in
// SWEEPABLE_JOB_NAMES (lib/admin/legacy/jobs.js) so the existing 5-min
// heartbeat-stale sweep reaps stuck rows.

import "server-only";

import { sbFetch } from "@/lib/admin/sb";
import { mlxChat, mlxConfigured, MlxError } from "@/lib/admin/mlx";
import { loadActivePrompt } from "@/lib/admin/llm-prompts";

const JOB_NAME = "llm_classify";

const K_PER_TICK = 4;
const WALL_TIME_MS = 60_000;
const HEARTBEAT_STALE_MS = 5 * 60 * 1000;
const RETRY_LIMIT = 3;

const MAX_CATEGORIES_PER_POSTING = 3;
const MAX_RATIONALE_CHARS = 400;

const TIER2_MODEL_MAX_TOKENS = 600;
const TIER2_MODEL_TEMPERATURE = 0.2;

type Sb = typeof sbFetch;
type Trigger = "manual" | "cron";

type CategoryAssignment = {
  slug: string;
  confidence: number;
};

type Tier2Output = {
  categories: CategoryAssignment[];
  rationale: string;
};

type Posting = {
  id: string;
  title: string | null;
  description: string | null;
};

type TaxonomyRow = {
  slug: string;
  title: string;
  definition_md: string;
  sort_order: number;
};

export type RunClassifyResult = {
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

export async function runClassify(args: {
  sb: Sb;
  trigger: Trigger;
}): Promise<RunClassifyResult> {
  const { sb, trigger } = args;

  if (!mlxConfigured()) {
    return { status: "skipped", reason: "no_api_key" };
  }
  if (await isRunning(sb)) {
    return { status: "skipped", reason: "already_running" };
  }

  const [prompt, taxonomy, currentVersion] = await Promise.all([
    loadActivePrompt(sb, "tier2"),
    loadLiveTaxonomy(sb),
    loadCurrentTaxonomyVersion(sb),
  ]);
  if (!prompt || taxonomy.length === 0) {
    return { status: "skipped", reason: "no_taxonomy" };
  }

  const validSlugs = new Set(taxonomy.map((t) => t.slug));
  const systemPrompt = prompt.body.replace(
    "{{categories_block}}",
    buildCategoriesBlock(taxonomy),
  );

  const candidates = await sb<Posting[]>(
    `/nav_postings?is_ai=is.true&tier2_completed_at=is.null` +
      `&llm_retry_count=lt.${RETRY_LIMIT}` +
      `&select=id,title,description&order=posted_at.desc&limit=${K_PER_TICK}`,
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
        taxonomy_version: currentVersion,
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
    await finalize(sb, job.id, "success", {
      processed: 0,
      parse_fails: 0,
      invalid_slug_drops: 0,
      http_fails: 0,
      auth_fails: 0,
      stopped: "queue_empty",
    });
    return {
      status: "success",
      job_id: job.id,
      metadata: {
        processed: 0,
        parse_fails: 0,
        invalid_slug_drops: 0,
        http_fails: 0,
        auth_fails: 0,
        stopped: "queue_empty",
      },
    };
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
      if (Date.now() - start > WALL_TIME_MS) {
        stopped = "wall_time";
        break;
      }
      const posting = candidates[idx];
      try {
        const r = await processOne(
          sb,
          posting,
          systemPrompt,
          prompt.id,
          validSlugs,
          currentVersion,
        );
        processed += 1;
        invalidSlugDrops += r.invalidSlugDrops;
      } catch (err) {
        if (err instanceof MlxError && err.kind === "auth") {
          authFails += 1;
          await markFailed(sb, posting.id, "tier2_auth_failed", false);
          stopped = "auth_failed";
          break;
        }
        if (err instanceof MlxError && err.kind === "parse") {
          parseFails += 1;
          await markFailed(sb, posting.id, "tier2_parse_failed", true);
        } else {
          httpFails += 1;
          await markFailed(sb, posting.id, "tier2_failed", true);
        }
      }
      // Heartbeat after each row — Tier 2 is slower so per-row is fine.
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
  posting: Posting,
  systemPrompt: string,
  promptId: string,
  validSlugs: Set<string>,
  taxonomyVersion: number,
): Promise<{ invalidSlugDrops: number }> {
  // Tier 2 uses the FULL description (vs Tier 1's first 1000 chars). Gemma 3
  // has 128K context so even very long postings fit comfortably.
  const description = posting.description ?? "";
  const userInput = `Tittel: ${posting.title ?? ""}\n\n${description}`;

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
      `tier2 output not valid JSON: ${resp.content.slice(0, 200)}`,
    );
  }

  // Drop assignments whose slug isn't in the live taxonomy. Surfaced via
  // metadata so /admin/llm can flag a model that's hallucinating new slugs.
  const accepted: CategoryAssignment[] = [];
  let invalidSlugDrops = 0;
  for (const c of parsed.categories) {
    if (!validSlugs.has(c.slug)) {
      invalidSlugDrops += 1;
      continue;
    }
    accepted.push({
      slug: c.slug,
      confidence: clampConfidence(c.confidence),
    });
    if (accepted.length >= MAX_CATEGORIES_PER_POSTING) break;
  }

  const persisted = {
    categories: accepted,
    rationale: parsed.rationale.slice(0, MAX_RATIONALE_CHARS),
    invalid_slugs_dropped: invalidSlugDrops,
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

function buildCategoriesBlock(taxonomy: TaxonomyRow[]): string {
  return taxonomy
    .map((t) => {
      const def = t.definition_md.trim();
      return def
        ? `- \`${t.slug}\` — ${t.title}: ${def}`
        : `- \`${t.slug}\` — ${t.title}`;
    })
    .join("\n");
}

function parseTier2(content: string): Tier2Output | null {
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

  const rawCategories = (obj as { categories?: unknown }).categories;
  if (!Array.isArray(rawCategories)) return null;
  const categories: CategoryAssignment[] = [];
  for (const c of rawCategories) {
    if (
      c &&
      typeof c === "object" &&
      typeof (c as { slug?: unknown }).slug === "string"
    ) {
      const slug = (c as { slug: string }).slug;
      const confidenceRaw = (c as { confidence?: unknown }).confidence;
      const confidence =
        typeof confidenceRaw === "number" ? confidenceRaw : 0.5;
      categories.push({ slug, confidence });
    }
  }
  const rationaleRaw = (obj as { rationale?: unknown }).rationale;
  const rationale =
    typeof rationaleRaw === "string" ? rationaleRaw : "";
  return { categories, rationale };
}

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

function clampConfidence(c: unknown): number {
  if (typeof c !== "number" || !Number.isFinite(c)) return 0.5;
  if (c < 0) return 0;
  if (c > 1) return 1;
  return c;
}

async function loadLiveTaxonomy(sb: Sb): Promise<TaxonomyRow[]> {
  return sb<TaxonomyRow[]>(
    "/taxonomy_categories?retired_at=is.null" +
      "&select=slug,title,definition_md,sort_order&order=sort_order.asc",
    { service: true },
  );
}

async function loadCurrentTaxonomyVersion(sb: Sb): Promise<number> {
  const rows = await sb<{ version: number }[]>(
    "/taxonomy_versions?select=version&order=version.desc&limit=1",
    { service: true },
  );
  return rows[0]?.version ?? 1;
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
