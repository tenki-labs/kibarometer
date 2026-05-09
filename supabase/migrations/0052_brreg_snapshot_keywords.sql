-- 0052_brreg_snapshot_keywords.sql
--
-- Brønnøysund parallel to NAV's snapshot_keywords (see 0008 + 0049 for the
-- /jobbmarked source of truth). Powers the "Mest brukte AI-fraser i nye
-- foretak siste 30 dager" segment on /oppstart.
--
-- Source: brreg_companies.matched_keywords_name and matched_keywords_aktivitet
-- — text[] arrays populated by the keyword matcher during enrichment. We
-- count distinct (orgnr, keyword) pairs over the last 30 days vs the same
-- 30-day window 365 days ago for YoY.
--
-- Keyword domain filter: status='canonical' and domain in ('brreg','any').
-- Aggregated by term with min(category) to defend against the same multi-row
-- subquery bug fixed for NAV in 0049.
--
-- Idempotent: pure CREATE OR REPLACE on the function, create-table guarded,
-- orchestrator redefined in full to add the new perform call.

-- 1. New snapshot table — column shape mirrors public.snapshot_keywords
create table if not exists public.brreg_snapshot_keywords (
  keyword          text primary key,
  category         text,                   -- tool / role / concept
  ai_count_30d     int not null,
  ai_count_30d_yoy int not null,           -- same 30d window 1y ago
  yoy_growth_pct   numeric,                -- null when prior window = 0; UI shows "ny"
  rank             int not null            -- by ai_count_30d desc; default sort
);

alter table public.brreg_snapshot_keywords enable row level security;

drop policy if exists brreg_snapshot_keywords_public_read
  on public.brreg_snapshot_keywords;
create policy brreg_snapshot_keywords_public_read
  on public.brreg_snapshot_keywords for select using (true);

-- 2. Refresh function
create or replace function public.refresh_brreg_snapshot_keywords() returns void
language plpgsql security definer set search_path = public as $$
begin
  truncate table public.brreg_snapshot_keywords;
  with active as (
    -- Aggregate by term with min(category) so the joined-side scalar
    -- subquery below sees exactly one row per term, even if the same
    -- term lands in keywords twice (multi-domain or category drift).
    select term, min(category) as category
      from public.keywords
     where status = 'canonical'
       and domain in ('brreg', 'any')
     group by term
  ),
  current_window as (
    -- count(distinct orgnr) ensures a company that matches the same
    -- keyword in BOTH matched_keywords_name and matched_keywords_aktivitet
    -- still counts once for that keyword.
    select kw, count(distinct bc.orgnr) as n
    from public.brreg_companies bc,
         unnest(bc.matched_keywords_name || bc.matched_keywords_aktivitet) as kw
    where bc.is_ai_relevant
      and bc.registrert_dato is not null
      and bc.registrert_dato >= current_date - 30
      and kw in (select term from active)
    group by kw
  ),
  prior_window as (
    select kw, count(distinct bc.orgnr) as n
    from public.brreg_companies bc,
         unnest(bc.matched_keywords_name || bc.matched_keywords_aktivitet) as kw
    where bc.is_ai_relevant
      and bc.registrert_dato is not null
      and bc.registrert_dato >= current_date - 395
      and bc.registrert_dato <  current_date - 365
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
  insert into public.brreg_snapshot_keywords
    (keyword, category, ai_count_30d, ai_count_30d_yoy, yoy_growth_pct, rank)
  select keyword, category, ai_count_30d, ai_count_30d_yoy, yoy_growth_pct,
         row_number() over (order by ai_count_30d desc, keyword)::int as rank
  from joined;
end;
$$;

-- 3. Orchestrator update — adds the new perform call. Keeps the 10-min
--    statement_timeout from 0042 and the founder-age yearly + monthly
--    perform calls from 0048/0051.
create or replace function public.refresh_all_brreg_snapshots() returns void
language plpgsql security definer
set search_path = public
set statement_timeout = '10min'
as $$
begin
  perform public.refresh_brreg_snapshot_daily();
  perform public.refresh_brreg_snapshot_geography();
  perform public.refresh_brreg_snapshot_focus_daily();
  perform public.refresh_brreg_snapshot_cohort();
  perform public.refresh_brreg_snapshot_founder_age_yearly();
  perform public.refresh_brreg_snapshot_founder_age_monthly();
  perform public.refresh_brreg_snapshot_keywords();
  perform public.refresh_brreg_snapshot_headline();
end;
$$;
