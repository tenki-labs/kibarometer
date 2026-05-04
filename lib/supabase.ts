// lib/supabase.ts — server-side PostgREST helper for the marketing app.
//
// Uses SUPABASE_INTERNAL_URL (Kong inside the Docker network) rather than the
// public host so reads stay on the kiba network and don't hairpin through the
// edge. The anon key is fine: every snapshot_* table has a public-read RLS
// policy from 0008_nav_snapshots.sql.
//
// All callers are server components / route handlers — never import this from
// a client component (no "use client" file should reach for it).

import { env } from "./env";

type Init = Omit<RequestInit, "body"> & {
  body?: unknown;
  // Override Next's revalidate per call. Default is 60s — snapshots refresh
  // once per day, so this is comfortably stale-tolerant; the dashboard's
  // visible "Sist oppdatert" stamp tells users when the snapshot was computed.
  revalidate?: number;
};

export async function sb<T = unknown>(path: string, init: Init = {}): Promise<T> {
  // CI/build-time short-circuit: `next build` prerenders every route, which
  // would call this fn with placeholder env where SUPABASE_INTERNAL_URL is
  // unreachable (ECONNREFUSED). Return empty so prerender succeeds; the
  // first real request after deploy hits the real Kong and ISR fills the
  // cache. Every consumer in this app expects an array shape, so [] is
  // type-compatible across the board.
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return [] as unknown as T;
  }
  const { revalidate = 60, body, headers, ...rest } = init;
  const res = await fetch(`${env.SUPABASE_INTERNAL_URL}/rest/v1${path}`, {
    ...rest,
    headers: {
      apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    next: { revalidate },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PostgREST ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

// ---- Row types mirroring the snapshot_* schema ------------------------

export type SnapshotHeadline = {
  computed_for: string;     // YYYY-MM-DD
  computed_at: string;      // ISO timestamp
  ai_count_7d: number;
  ai_count_30d: number;
  ai_count_prev_30d: number;
  ai_share_30d: number;     // 0..1
};

export type SnapshotDaily = {
  posted_on: string;        // YYYY-MM-DD
  ai_count: number;
  total_count: number;
};

export type SnapshotMonthly = {
  posted_month: string;     // YYYY-MM-01
  ai_count: number;
  total_count: number;
};

export type SnapshotKeyword = {
  keyword: string;
  category: string | null;  // tool / role / concept
  ai_count_30d: number;
  ai_count_30d_yoy: number;
  yoy_growth_pct: number | null;
  rank: number;
};

export type SnapshotGeography = {
  county: string;
  ai_count_30d: number;
  total_count_30d: number;
};

export type SnapshotCategory = {
  category: string;
  ai_count_30d: number;
  total_count_30d: number;
};

export type SnapshotCategoryDaily = {
  posted_on: string;        // YYYY-MM-DD
  category: string;
  ai_count: number;
  total_count: number;
};

export type SnapshotSkillCategoryDaily = {
  posted_on: string;        // YYYY-MM-DD
  slug: string;
  ai_count: number;
};

// AI-skill category snapshot (LLM Tier 2 classification rolled up per slug).
// See 0021_skill_snapshot.sql. The home page reads the rows for the latest
// `computed_for` and joins with taxonomy_categories on slug to pick up the
// human-readable title.
export type SnapshotSkillCategory = {
  computed_for: string;     // YYYY-MM-DD
  slug: string;
  ai_count_30d: number;
  ai_count_7d: number;
  share_pct: number | null;
};

// Public taxonomy row used by /metode and the home-page skill chart.
export type TaxonomyCategory = {
  slug: string;
  title: string;
  definition_md: string;
  sort_order: number;
};

// Public keyword (used by /metode methodology page).
export type Keyword = {
  id: string;
  term: string;
  language: "no" | "en" | "any";
  category: "tool" | "role" | "concept";
  match_type: "word" | "substring";
  notes: string | null;
};
