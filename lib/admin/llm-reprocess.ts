// lib/admin/llm-reprocess.ts — operator-triggered reset of Tier 2 results.
//
// Operator semantics: "I edited the taxonomy / the prompt / a category
// definition. Re-classify the matching subset on the next Tier 2 cron tick."
//
// Doesn't call the LLM directly — just sets tier2_completed_at = null and
// llm_retry_count = 0 on the matching rows. The regular Tier 2 cron picks
// them up. This keeps reprocess synchronous and fast (single UPDATE) while
// reusing all the Tier 2 retry/heartbeat machinery for the actual work.
//
// Three scopes covered in PR 3:
//   * all_ai      — every is_ai=true row
//   * category    — rows previously classified with a given slug
//   * since_date  — is_ai=true rows posted after a given ISO date
//
// PR 6 will reuse this orchestrator for keyword-promotion back-fill (different
// SQL, same audit shape).

import "server-only";

import { sbFetch } from "@/lib/admin/sb";

const JOB_NAME = "llm_reprocess";

type Sb = typeof sbFetch;
type Trigger = "manual" | "cron";

export type ReprocessScope = "all_ai" | "category" | "since_date";

export type ReprocessArgs = {
  sb: Sb;
  trigger: Trigger;
  scope: ReprocessScope;
  category_slug?: string;
  since_date?: string;
  dry_run?: boolean;
};

export type ReprocessResult = {
  status: "success" | "noop" | "error";
  scope: ReprocessScope;
  matched: number;
  reset: number;
  dry_run: boolean;
  job_id?: string;
  error?: string;
};

export async function runReprocess(
  args: ReprocessArgs,
): Promise<ReprocessResult> {
  const { sb, trigger, scope, category_slug, since_date, dry_run = false } = args;

  // Build the row filter once. Each scope produces a PostgREST query suffix
  // applied to /nav_postings.
  let filter: string;
  switch (scope) {
    case "all_ai":
      filter = "is_ai=is.true";
      break;
    case "category": {
      if (!category_slug) {
        return errorResult(scope, dry_run, "category_slug required for scope=category");
      }
      // jsonb contains: llm_categories.categories array contains an object
      // whose slug matches. Operator on PostgREST: cs (contains).
      const containsValue = JSON.stringify({
        categories: [{ slug: category_slug }],
      });
      filter = `is_ai=is.true&llm_categories=cs.${encodeURIComponent(containsValue)}`;
      break;
    }
    case "since_date": {
      if (!since_date || !isIsoDate(since_date)) {
        return errorResult(
          scope,
          dry_run,
          "since_date must be an ISO date (YYYY-MM-DD)",
        );
      }
      filter = `is_ai=is.true&posted_at=gte.${encodeURIComponent(since_date)}`;
      break;
    }
    default:
      return errorResult(scope, dry_run, `unknown scope: ${scope}`);
  }

  // Count matches first. Used both for dry-run and as the metadata baseline.
  const countRows = await sb<{ count: number }[] | { count: number }>(
    `/nav_postings?${filter}&select=count`,
    { service: true, headers: { Prefer: "count=exact" } },
  );
  const matched = Array.isArray(countRows)
    ? (countRows[0]?.count ?? 0)
    : (countRows as { count: number }).count;

  if (dry_run) {
    return {
      status: "success",
      scope,
      matched,
      reset: 0,
      dry_run: true,
    };
  }

  if (matched === 0) {
    return {
      status: "noop",
      scope,
      matched: 0,
      reset: 0,
      dry_run: false,
    };
  }

  const [job] = await sb<{ id: string }[]>(`/jobs`, {
    service: true,
    method: "POST",
    body: {
      name: JOB_NAME,
      trigger,
      metadata: { scope, category_slug, since_date, matched },
    },
    prefer: "return=representation",
  });

  try {
    // Reset both columns. tier2_completed_at=null re-queues the row; the
    // retry counter reset prevents past retries from blocking the new run.
    await sb(`/nav_postings?${filter}`, {
      service: true,
      method: "PATCH",
      body: { tier2_completed_at: null, llm_retry_count: 0 },
      prefer: "return=minimal",
    });

    await sb(`/jobs?id=eq.${encodeURIComponent(job.id)}`, {
      service: true,
      method: "PATCH",
      body: {
        finished_at: new Date().toISOString(),
        status: "success",
        rows_processed: matched,
        metadata: { scope, category_slug, since_date, matched, reset: matched },
      },
    });

    return {
      status: "success",
      scope,
      matched,
      reset: matched,
      dry_run: false,
      job_id: job.id,
    };
  } catch (err) {
    await sb(`/jobs?id=eq.${encodeURIComponent(job.id)}`, {
      service: true,
      method: "PATCH",
      body: {
        finished_at: new Date().toISOString(),
        status: "failed",
        error: String(err instanceof Error ? err.message : err).slice(0, 1000),
        metadata: { scope, category_slug, since_date, matched },
      },
    }).catch(() => {});
    throw err;
  }
}

function errorResult(
  scope: ReprocessScope,
  dry_run: boolean,
  message: string,
): ReprocessResult {
  return {
    status: "error",
    scope,
    matched: 0,
    reset: 0,
    dry_run,
    error: message,
  };
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(s);
}
