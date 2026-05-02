-- 0007_nav_postings.sql
-- Phase C: one row per NAV posting. Populated by the inline processor
-- (scripts/nav/processor.js) after each fetch/backfill batch writes nav_raw.
--
-- Two-tier population:
--   1. SUMMARY (always, from the feed item itself): id, title, employer_name,
--      location_municipality, posted_at (= sistEndret proxy), source_url,
--      status. Tagged against title only — recall is poor, by design.
--   2. DETAIL (background enrichment, ACTIVE postings only): description,
--      occupation, location_county, expires_at, apply_url, category. Re-tagged
--      against title + description, then detail_fetched_at + retagged_at set.
--
-- The `payload jsonb` column from the original v1-plan is intentionally dropped:
-- it would duplicate nav_raw.payload->'items'[uuid], and retagging reads from
-- the title/description columns directly (no JSON parse needed).
--
-- Idempotent.

create table if not exists public.nav_postings (
  id text primary key,
  nav_raw_id uuid references public.nav_raw(id) on delete set null,

  -- summary fields (always populated from feed item)
  title text,
  employer_name text,
  location_municipality text,
  status text,                         -- 'ACTIVE' | 'INACTIVE' | null
  source_url text,

  -- detail fields (populated by enrichment for ACTIVE postings)
  description text,
  occupation text,
  category text,
  location_county text,
  location_country text default 'NO',
  expires_at timestamptz,
  apply_url text,

  -- timing
  posted_at timestamptz,
  ingested_at timestamptz not null default now(),
  retagged_at timestamptz,
  detail_fetched_at timestamptz,

  -- tagging
  is_ai boolean not null default false,
  matched_keywords text[] not null default '{}'
);

create index if not exists nav_postings_posted_at_idx
  on public.nav_postings (posted_at desc);
create index if not exists nav_postings_is_ai_posted_at_idx
  on public.nav_postings (posted_at desc) where is_ai;
create index if not exists nav_postings_keywords_gin
  on public.nav_postings using gin (matched_keywords);
create index if not exists nav_postings_county_idx
  on public.nav_postings (location_county) where is_ai;

-- Enrichment queue: ACTIVE postings without detail. Partial keeps it tiny —
-- steady-state ≤ ~100k rows since NAV ads expire after 6 months.
create index if not exists nav_postings_enrich_queue_idx
  on public.nav_postings (posted_at desc)
  where status = 'ACTIVE' and detail_fetched_at is null;

alter table public.nav_postings enable row level security;

-- Public read — the marketing site (anon key) reads aggregated snapshots in
-- Phase D, but we expose nav_postings too for ad-hoc / API use.
drop policy if exists nav_postings_public_read on public.nav_postings;
create policy nav_postings_public_read on public.nav_postings
  for select using (true);
