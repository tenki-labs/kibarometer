// lib/public-data/jobs.ts — the single floored data path for the public NAV
// (arbeidsmarked) snapshot surfaces: /api/v1/trend and /embed/trend.
//
// Why this exists: the public /arbeidsmarked chart truncates at
// JOBBMARKED_DATA_CUTOFF because pre-cutoff NAV rows are title-only and
// undercount AI ~10x (see app/(site)/_lib/data-cutoff.ts). The trend API and
// embed used to read snapshot_monthly, which refresh_snapshot_monthly() builds
// over ALL postings with no floor — so they leaked the exact pre-cutoff
// artifact months the site hides. Deriving the monthly trend here from the same
// floored snapshot_daily rows the page charts guarantees the API/embed can
// never diverge from the site. A CI guard forbids app/api & app/embed from
// reading snapshot_daily / snapshot_monthly directly, so new public surfaces
// must come through this module.

import {
  sb,
  type SnapshotDaily,
  type SnapshotHeadline,
  type SnapshotMonthly,
} from "@/lib/supabase";
import { JOBBMARKED_DATA_CUTOFF } from "@/app/(site)/_lib/data-cutoff";

/**
 * Sum floored daily rows into first-of-month buckets, ascending. Pure, so the
 * bucketing is unit-tested without a database. The first bucket is whatever
 * partial month the cutoff lands in (e.g. April 2026 counts from the 13th) —
 * matching the /arbeidsmarked "max" range exactly.
 */
export function bucketMonthly(
  rows: readonly SnapshotDaily[],
): SnapshotMonthly[] {
  const months = new Map<string, SnapshotMonthly>();
  for (const r of rows) {
    const posted_month = `${r.posted_on.slice(0, 7)}-01`;
    const bucket = months.get(posted_month) ?? {
      posted_month,
      ai_count: 0,
      total_count: 0,
    };
    bucket.ai_count += r.ai_count;
    bucket.total_count += r.total_count;
    months.set(posted_month, bucket);
  }
  return [...months.values()].sort((a, b) =>
    a.posted_month.localeCompare(b.posted_month),
  );
}

/**
 * Monthly AI-vs-total posting trend for the public NAV surfaces, floored at
 * JOBBMARKED_DATA_CUTOFF. Identical shape to the legacy snapshot_monthly read,
 * so /api/v1/trend and /embed/trend consumers see no change beyond the
 * pre-cutoff artifact months disappearing.
 */
export async function getJobsTrendMonthly(): Promise<SnapshotMonthly[]> {
  const daily = await sb<SnapshotDaily[]>(
    `/snapshot_daily?posted_on=gte.${JOBBMARKED_DATA_CUTOFF}` +
      `&order=posted_on.asc&select=posted_on,ai_count,total_count`,
  );
  return bucketMonthly(daily);
}

export type JobsHeadlineRecent = {
  headline: SnapshotHeadline | null;
  /** Most recent 30 daily rows, newest-first — for the embed sparkline. */
  recentDaily: SnapshotDaily[];
};

/**
 * Latest headline row plus the recent daily window for /embed/headline. The
 * daily read is `order=posted_on.desc&limit=30`, so it is self-flooring by
 * recency (the most recent 30 days are always well past the cutoff) — no gte
 * needed. Centralised here anyway so every public NAV snapshot_daily read goes
 * through this module and the CI guard can forbid direct reads outright.
 */
export async function getJobsHeadlineRecent(): Promise<JobsHeadlineRecent> {
  const [headlineRows, recentDaily] = await Promise.all([
    sb<SnapshotHeadline[]>("/snapshot_headline?order=computed_for.desc&limit=1"),
    sb<SnapshotDaily[]>("/snapshot_daily?order=posted_on.desc&limit=30"),
  ]);
  return { headline: headlineRows[0] ?? null, recentDaily };
}
