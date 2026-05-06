// Admin jobs helpers shared across the dashboard, /admin/processes, and
// the per-domain hub pages. Single source of truth for:
//   - mapping a `jobs.name` to the domain it belongs to (for badges)
//   - looking up the most recent job by name (for OperationCard footers)
//
// Job names in the `jobs` table are inconsistent (legacy: some have a
// `nav_*` / `media_*` / `brreg_*` prefix, some don't, some are bare verbs
// like `refresh_snapshots`). Rather than rename rows in production we
// keep an explicit name → domain map here. New job names should follow
// the convention `{domain}_{verb}` so this map can shrink over time.

import { sbFetch } from "@/lib/admin/sb";

export type JobDomain = "nav" | "media" | "brreg" | "llm" | "system";

const NAME_TO_DOMAIN: Record<string, JobDomain> = {
  // NAV — the legacy default for unprefixed names.
  fetch_nav_stillingsfeed: "nav",
  backfill_nav_stillingsfeed: "nav",
  backfill_drain: "nav",
  enrich_nav: "nav",
  reprocess_nav_postings: "nav",
  refresh_snapshots: "nav",
  refresh_keyword_candidates: "nav",
  refresh_skill_categories: "nav",
};

export function jobDomain(name: string): JobDomain {
  if (name in NAME_TO_DOMAIN) return NAME_TO_DOMAIN[name];
  if (name.startsWith("media_")) return "media";
  if (name.startsWith("brreg_")) return "brreg";
  if (name.startsWith("llm_")) return "llm";
  if (name.startsWith("nav_")) return "nav";
  return "system";
}

export const DOMAIN_LABEL: Record<JobDomain, string> = {
  nav: "NAV",
  media: "Media",
  brreg: "Brreg",
  llm: "LLM",
  system: "Sys",
};

export type LastJobRun = {
  status: string;
  started_at: string;
  finished_at: string | null;
  rows_processed: number | null;
  error: string | null;
};

// Single PostgREST call. Returns null if the job has never run.
// Call from server components or actions only — not safe for client.
export async function getLastJobRun(name: string): Promise<LastJobRun | null> {
  const rows = await sbFetch<LastJobRun[]>(
    `/jobs?name=eq.${encodeURIComponent(name)}&order=started_at.desc&limit=1` +
      `&select=status,started_at,finished_at,rows_processed,error`,
    { service: true },
  ).catch(() => [] as LastJobRun[]);
  return rows[0] ?? null;
}
