-- 0056_tier2_coverage_daily.sql
--
-- Per-pillar daily snapshots tracking how much of the keyword-flagged
-- AI corpus has been Tier-2 categorized. Drives the "LLM-validert: X%
-- av AI-treff i valgt periode" coverage banner on the public scrollers
-- so users can tell sparse-because-unprocessed apart from
-- sparse-because-no-data.
--
-- Two snapshot tables — one for NAV, one for media. /oppstart's public
-- charts don't depend on Tier 2 categories (they pivot on NACE codes
-- populated at ingest), so a brreg coverage snapshot would be unused;
-- add it when an /oppstart chart ever reads `llm_categories`.
--
-- Each row aggregates a single calendar date:
--   ai_total     — rows flagged AI by the keyword matcher on that date
--   tier2_done   — of those, how many also have tier2_completed_at NOT NULL
--   coverage_pct — generated column = round(tier2_done / ai_total * 100, 2)
--                  (100 when ai_total = 0 — no data is "perfect coverage"
--                   so the banner doesn't render a misleading 0%)
--
-- Refreshed by each pillar's existing orchestrator. Truncate-and-rebuild
-- pattern matches the rest of the snapshot family.
--
-- Idempotent.

-- ── NAV ──────────────────────────────────────────────────────────────────

create table if not exists public.snapshot_tier2_coverage_daily (
  date         date primary key,
  ai_total     int  not null,
  tier2_done   int  not null,
  coverage_pct numeric(5,2) generated always as (
    case when ai_total = 0 then 100
         else round(tier2_done::numeric / ai_total * 100, 2)
    end
  ) stored
);

alter table public.snapshot_tier2_coverage_daily enable row level security;

drop policy if exists snapshot_tier2_coverage_daily_anon_read
  on public.snapshot_tier2_coverage_daily;
create policy snapshot_tier2_coverage_daily_anon_read
  on public.snapshot_tier2_coverage_daily for select using (true);

create or replace function public.refresh_snapshot_tier2_coverage_daily()
returns void language plpgsql security definer set search_path = public as $$
begin
  truncate table public.snapshot_tier2_coverage_daily;
  insert into public.snapshot_tier2_coverage_daily (date, ai_total, tier2_done)
  select
    posted_at::date as date,
    count(*) filter (where is_ai)::int as ai_total,
    count(*) filter (where is_ai and tier2_completed_at is not null)::int as tier2_done
  from public.nav_postings
  where posted_at is not null
  group by posted_at::date
  having count(*) filter (where is_ai) > 0;
end;
$$;

-- ── Media ────────────────────────────────────────────────────────────────

create table if not exists public.media_snapshot_tier2_coverage_daily (
  date         date primary key,
  ai_total     int  not null,
  tier2_done   int  not null,
  coverage_pct numeric(5,2) generated always as (
    case when ai_total = 0 then 100
         else round(tier2_done::numeric / ai_total * 100, 2)
    end
  ) stored
);

alter table public.media_snapshot_tier2_coverage_daily enable row level security;

drop policy if exists media_snapshot_tier2_coverage_daily_anon_read
  on public.media_snapshot_tier2_coverage_daily;
create policy media_snapshot_tier2_coverage_daily_anon_read
  on public.media_snapshot_tier2_coverage_daily for select using (true);

create or replace function public.refresh_media_snapshot_tier2_coverage_daily()
returns void language plpgsql security definer set search_path = public as $$
begin
  truncate table public.media_snapshot_tier2_coverage_daily;
  insert into public.media_snapshot_tier2_coverage_daily (date, ai_total, tier2_done)
  select
    published_at::date as date,
    count(*) filter (where is_ai_related)::int as ai_total,
    count(*) filter (where is_ai_related and tier2_completed_at is not null)::int as tier2_done
  from public.media_articles
  where published_at is not null
    and deleted_at is null
  group by published_at::date
  having count(*) filter (where is_ai_related) > 0;
end;
$$;

-- ── Wire into orchestrators ─────────────────────────────────────────────

create or replace function public.refresh_all_snapshots() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_snapshot_headline();
  perform public.refresh_snapshot_daily();
  perform public.refresh_snapshot_monthly();
  perform public.refresh_snapshot_keywords();
  perform public.refresh_snapshot_geography();
  perform public.refresh_snapshot_category();
  perform public.refresh_snapshot_category_daily();
  perform public.refresh_snapshot_skill_category_daily();
  perform public.refresh_snapshot_tier2_coverage_daily();
end;
$$;

create or replace function public.refresh_all_media_snapshots() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_media_snapshot_daily();
  perform public.refresh_media_snapshot_category_daily();
  perform public.refresh_media_snapshot_source_category_daily();
  perform public.refresh_media_anomaly_daily();
  perform public.refresh_media_snapshot_index();
  perform public.refresh_media_snapshot_tier2_coverage_daily();
end;
$$;
