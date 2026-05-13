-- 0065_brreg_snapshot_quarterly_ai_growth.sql
--
-- Quarterly year-on-year % growth of AI-relevant BRREG registrations.
-- Powers the /oppstart PillarHero KPI and the new quarterly-yoy bar
-- chart, plus replaces the landing page's "siste 30 dager vs.
-- foregående 30" MoM stat with a more cite-able YoY number.
--
-- Excludes the in-progress current quarter so journalists never cite
-- partial data. Floor matches the BRREG-wide 2018-01-01 floor from
-- 0047. Historical drift from a growing keyword catalog is handled
-- elsewhere (weekly retag cron, Sun 03:50 UTC); this table is
-- truncate + insert on every refresh so it always reflects today's
-- ai_keywords definitions.

create table if not exists public.brreg_snapshot_quarterly_ai_growth (
  reg_quarter         date primary key,    -- date_trunc('quarter', registrert_dato)::date
  ai_count            int  not null,       -- AI-relevant foretak registered in that quarter
  ai_count_yoy_prior  int,                 -- same quarter one year prior; null when no prior row
  yoy_growth_pct      numeric(6,1)         -- (curr - prior) / prior * 100; null when prior is null or 0
);

alter table public.brreg_snapshot_quarterly_ai_growth enable row level security;

drop policy if exists brreg_snapshot_quarterly_ai_growth_public_read
  on public.brreg_snapshot_quarterly_ai_growth;
create policy brreg_snapshot_quarterly_ai_growth_public_read
  on public.brreg_snapshot_quarterly_ai_growth for select using (true);

-- Refresh function. Truncate + insert keeps it cheap (~33 rows) and
-- means the snapshot always reflects the current is_ai_relevant state
-- after each weekly retag.
create or replace function public.refresh_brreg_snapshot_quarterly_ai_growth()
returns void language plpgsql security definer
set search_path = public as $$
begin
  truncate table public.brreg_snapshot_quarterly_ai_growth;
  insert into public.brreg_snapshot_quarterly_ai_growth
    (reg_quarter, ai_count, ai_count_yoy_prior, yoy_growth_pct)
  with q as (
    select date_trunc('quarter', registrert_dato)::date as reg_quarter,
           count(*) filter (where is_ai_relevant)       as ai_count
    from public.brreg_companies
    where registrert_dato is not null
      and registrert_dato >= date '2018-01-01'
      and registrert_dato <  date_trunc('quarter', current_date)::date
    group by 1
  )
  select c.reg_quarter,
         c.ai_count::int,
         p.ai_count::int,
         case when p.ai_count is null or p.ai_count = 0 then null
              else round(((c.ai_count - p.ai_count)::numeric / p.ai_count) * 100, 1)
         end
  from q c
  left join q p on p.reg_quarter = (c.reg_quarter - interval '1 year')::date;
end;
$$;

-- Re-emit the orchestrator with the new perform inserted. Source body
-- comes from 0064_brreg_financials.sql:424-441 verbatim, plus the new
-- line. Future snapshot migrations must follow the same pattern.
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
  perform public.refresh_brreg_snapshot_quarterly_ai_growth();
  perform public.refresh_brreg_snapshot_keywords();
  perform public.refresh_brreg_snapshot_financials_yearly();
  perform public.refresh_brreg_snapshot_financials_cohort();
  perform public.refresh_brreg_snapshot_headline();
end;
$$;
