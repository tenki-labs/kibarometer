-- 0008_nav_snapshots.sql
-- Phase D: pre-computed dashboard views.
--
-- Six tables driven by one orchestrator function (refresh_all_snapshots) that
-- recomputes everything in a single transaction. Cron at 04:00 (after the
-- 03:00 backup). The dashboard reads these via PostgREST with the anon key
-- (public-read RLS), so the runtime cost of /api/v1/* and / is one cheap
-- index lookup, not a snapshot recompute.
--
-- Retention model:
--   - snapshot_headline:  one row per day, full history (citation permalinks
--                         like ?as_of=YYYY-MM-DD pin to a specific date).
--   - snapshot_monthly:   one row per posted_month, history retained for the
--                         36-month trend chart.
--   - snapshot_daily:     one row per posted_on, full history (cheap; ~1
--                         row/day means ~1k rows steady-state).
--   - snapshot_keywords/geography/category:
--                         current-only — recomputed from scratch each run.
--                         Citation stability comes from the visible
--                         "computed_at" stamp on the dashboard, not URL pins.
--
-- All refresh functions are SECURITY DEFINER so the admin's service-role key
-- can call them via PostgREST /rpc/<name> without RLS getting in the way.
-- Idempotent: re-running on the same calendar day updates rows in place.

-- ---------- tables --------------------------------------------------------

create table if not exists public.snapshot_daily (
  posted_on date primary key,
  ai_count int not null,
  total_count int not null
);

create table if not exists public.snapshot_monthly (
  posted_month date primary key,                -- first-of-month
  ai_count int not null,
  total_count int not null
);

create table if not exists public.snapshot_keywords (
  keyword text primary key,
  category text,                                -- tool / role / concept
  ai_count_30d int not null,
  ai_count_30d_yoy int not null,                -- same 30d window 1y ago
  yoy_growth_pct numeric,                       -- null when prior window = 0; UI shows "ny"
  rank int not null                             -- by ai_count_30d desc; default sort
);

create table if not exists public.snapshot_geography (
  county text primary key,
  ai_count_30d int not null,
  total_count_30d int not null
);

create table if not exists public.snapshot_category (
  category text primary key,
  ai_count_30d int not null,
  total_count_30d int not null
);

create table if not exists public.snapshot_headline (
  computed_for date primary key,                -- one row per day; full history retained
  computed_at timestamptz not null,
  ai_count_7d int not null,                     -- AI postings posted in last 7 days (flow, not stock)
  ai_count_30d int not null,
  ai_count_prev_30d int not null,               -- prior 30d window — used by the auto headline sentence
  ai_share_30d numeric(6,5) not null            -- 0..1 share of all postings in last 30d
);

-- ---------- public read RLS ----------------------------------------------

alter table public.snapshot_daily      enable row level security;
alter table public.snapshot_monthly    enable row level security;
alter table public.snapshot_keywords   enable row level security;
alter table public.snapshot_geography  enable row level security;
alter table public.snapshot_category   enable row level security;
alter table public.snapshot_headline   enable row level security;

drop policy if exists snapshot_daily_public_read     on public.snapshot_daily;
drop policy if exists snapshot_monthly_public_read   on public.snapshot_monthly;
drop policy if exists snapshot_keywords_public_read  on public.snapshot_keywords;
drop policy if exists snapshot_geography_public_read on public.snapshot_geography;
drop policy if exists snapshot_category_public_read  on public.snapshot_category;
drop policy if exists snapshot_headline_public_read  on public.snapshot_headline;

create policy snapshot_daily_public_read     on public.snapshot_daily     for select using (true);
create policy snapshot_monthly_public_read   on public.snapshot_monthly   for select using (true);
create policy snapshot_keywords_public_read  on public.snapshot_keywords  for select using (true);
create policy snapshot_geography_public_read on public.snapshot_geography for select using (true);
create policy snapshot_category_public_read  on public.snapshot_category  for select using (true);
create policy snapshot_headline_public_read  on public.snapshot_headline  for select using (true);

-- ---------- refresh functions --------------------------------------------

-- Headline: upsert on computed_for so re-running same day is idempotent.
-- The auto-headline sentence in Phase E reads ai_count_30d vs ai_count_prev_30d.
create or replace function public.refresh_snapshot_headline() returns void
language sql security definer set search_path = public as $$
  insert into public.snapshot_headline (
    computed_for, computed_at,
    ai_count_7d, ai_count_30d, ai_count_prev_30d, ai_share_30d
  )
  select
    current_date,
    now(),
    count(*) filter (where is_ai and posted_at >= now() - interval '7 days'),
    count(*) filter (where is_ai and posted_at >= now() - interval '30 days'),
    count(*) filter (where is_ai
                       and posted_at >= now() - interval '60 days'
                       and posted_at <  now() - interval '30 days'),
    case when count(*) filter (where posted_at >= now() - interval '30 days') = 0
         then 0
         else round(
           (count(*) filter (where is_ai and posted_at >= now() - interval '30 days'))::numeric
             / count(*) filter (where posted_at >= now() - interval '30 days'),
           5)
    end
  from public.nav_postings
  on conflict (computed_for) do update set
    computed_at        = excluded.computed_at,
    ai_count_7d        = excluded.ai_count_7d,
    ai_count_30d       = excluded.ai_count_30d,
    ai_count_prev_30d  = excluded.ai_count_prev_30d,
    ai_share_30d       = excluded.ai_share_30d;
$$;

-- Daily: full-history truncate+insert. Cheap (~1k rows steady-state).
create or replace function public.refresh_snapshot_daily() returns void
language plpgsql security definer set search_path = public as $$
begin
  -- truncate, not delete: the supabase fleet enables pg_safeupdate, which
  -- blocks unconstrained DELETE via the PostgREST connection. truncate is
  -- DDL so it bypasses that check, and it's faster anyway.
  truncate table public.snapshot_daily;
  insert into public.snapshot_daily (posted_on, ai_count, total_count)
  select
    posted_at::date,
    count(*) filter (where is_ai),
    count(*)
  from public.nav_postings
  where posted_at is not null
  group by posted_at::date;
end;
$$;

-- Monthly: upsert on first-of-month. History grows by 1 row/month.
create or replace function public.refresh_snapshot_monthly() returns void
language sql security definer set search_path = public as $$
  insert into public.snapshot_monthly (posted_month, ai_count, total_count)
  select
    date_trunc('month', posted_at)::date,
    count(*) filter (where is_ai),
    count(*)
  from public.nav_postings
  where posted_at is not null
  group by 1
  on conflict (posted_month) do update set
    ai_count    = excluded.ai_count,
    total_count = excluded.total_count;
$$;

-- Keywords: current-only, ranked by ai_count_30d. Filtered to keywords that
-- are still active in public.keywords (so deactivating a keyword removes it
-- from the dashboard on the next refresh, even if old postings still carry
-- the term in matched_keywords until reprocess runs).
create or replace function public.refresh_snapshot_keywords() returns void
language plpgsql security definer set search_path = public as $$
begin
  truncate table public.snapshot_keywords;
  with active as (
    select term, category from public.keywords where is_active
  ),
  current_window as (
    select kw, count(*) as n
    from public.nav_postings, unnest(matched_keywords) as kw
    where is_ai
      and posted_at >= now() - interval '30 days'
      and kw in (select term from active)
    group by kw
  ),
  prior_window as (
    select kw, count(*) as n
    from public.nav_postings, unnest(matched_keywords) as kw
    where is_ai
      and posted_at >= now() - interval '395 days'
      and posted_at <  now() - interval '365 days'
      and kw in (select term from active)
    group by kw
  ),
  joined as (
    select
      c.kw                                              as keyword,
      (select category from active a where a.term = c.kw) as category,
      c.n::int                                          as ai_count_30d,
      coalesce(p.n, 0)::int                             as ai_count_30d_yoy,
      case when coalesce(p.n, 0) = 0 then null
           else round(((c.n - p.n)::numeric / p.n) * 100, 1)
      end                                               as yoy_growth_pct
    from current_window c
    left join prior_window p on p.kw = c.kw
  )
  insert into public.snapshot_keywords (keyword, category, ai_count_30d, ai_count_30d_yoy, yoy_growth_pct, rank)
  select keyword, category, ai_count_30d, ai_count_30d_yoy, yoy_growth_pct,
         row_number() over (order by ai_count_30d desc, keyword)::int as rank
  from joined;
end;
$$;

-- Geography: by county (location_county). Only populated for enriched rows;
-- pre-enrichment rows have null county and are excluded.
create or replace function public.refresh_snapshot_geography() returns void
language plpgsql security definer set search_path = public as $$
begin
  truncate table public.snapshot_geography;
  insert into public.snapshot_geography (county, ai_count_30d, total_count_30d)
  select
    location_county,
    count(*) filter (where is_ai),
    count(*)
  from public.nav_postings
  where location_county is not null
    and posted_at >= now() - interval '30 days'
  group by location_county;
end;
$$;

-- Category (yrkeskategori): from nav_postings.category, populated by enrichment.
create or replace function public.refresh_snapshot_category() returns void
language plpgsql security definer set search_path = public as $$
begin
  truncate table public.snapshot_category;
  insert into public.snapshot_category (category, ai_count_30d, total_count_30d)
  select
    category,
    count(*) filter (where is_ai),
    count(*)
  from public.nav_postings
  where category is not null
    and posted_at >= now() - interval '30 days'
  group by category;
end;
$$;

-- Orchestrator: one transaction, all six refreshes. PostgREST exposes this at
-- POST /rpc/refresh_all_snapshots. Admin calls with the service-role key.
create or replace function public.refresh_all_snapshots() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_snapshot_headline();
  perform public.refresh_snapshot_daily();
  perform public.refresh_snapshot_monthly();
  perform public.refresh_snapshot_keywords();
  perform public.refresh_snapshot_geography();
  perform public.refresh_snapshot_category();
end;
$$;
