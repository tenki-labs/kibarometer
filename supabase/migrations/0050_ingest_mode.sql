-- 0050_ingest_mode.sql
--
-- Add `ingest_mode` discriminator to all three pillar tables (plus
-- media_url_queue, since media articles inherit the mode from their
-- queue row). 'live' rows are eligible for LLM Tier 1; 'backfill' rows
-- never reach the Tier 1 queue. Tier 2 is intentionally NOT gated on
-- ingest_mode — its job is full classification coverage of every
-- keyword-matched row, backfill included.
--
-- Default 'backfill' is load-bearing: every existing row is frozen out
-- of Tier 1 the moment this migration applies. Live cron paths stamp
-- 'live' on insert (lib/admin/legacy/{nav-processor,jobs,brreg,
-- media-discover}.js); historical sweeps stamp 'backfill'
-- (fastForwardAction loop, media-backfill, brreg bootstrap).
--
-- Idempotent.

alter table public.nav_postings
  add column if not exists ingest_mode text not null default 'backfill'
    check (ingest_mode in ('live','backfill'));

alter table public.media_articles
  add column if not exists ingest_mode text not null default 'backfill'
    check (ingest_mode in ('live','backfill'));

alter table public.media_url_queue
  add column if not exists ingest_mode text not null default 'backfill'
    check (ingest_mode in ('live','backfill'));

alter table public.brreg_companies
  add column if not exists ingest_mode text not null default 'backfill'
    check (ingest_mode in ('live','backfill'));

-- Partial indexes matching the new Tier 1 selectors. Mirrors the shape
-- of nav_postings_is_ai_posted_at_idx (0007:52-53).

create index if not exists nav_postings_tier1_live_idx
  on public.nav_postings (posted_at desc)
  where tier1_completed_at is null and ingest_mode = 'live';

create index if not exists media_articles_tier1_live_idx
  on public.media_articles (created_at desc)
  where is_ai_related and tier1_completed_at is null
    and ingest_mode = 'live' and deleted_at is null;

create index if not exists brreg_companies_tier1_live_idx
  on public.brreg_companies (registrert_dato desc)
  where is_ai_relevant and tier1_completed_at is null
    and ingest_mode = 'live';
