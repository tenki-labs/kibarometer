-- 0051_brreg_founder_age_monthly.sql
--
-- Monthly companion to 0048's yearly founder-age snapshot. Powers the
-- "Median alder ved registrering — AI vs ikke-AI" two-line chart on
-- /oppstart, which now responds to the page's shared time-range toggle.
-- One row per (registration month, is_ai_relevant), sourced from
-- public.brreg_companies via the same youngest_role_age_at_reg column
-- that powers the yearly snapshot.
--
-- Median formula identical to 0048: percentile_cont(0.5) within group
-- (order by youngest_role_age_at_reg) — Postgres' standard
-- continuous-interpolation median. p25/p75 use 0.25/0.75 likewise.
--
-- Yearly snapshot (0048) is left in place. The orchestrator runs both;
-- /oppstart simply stops reading the yearly table.
--
-- Idempotent — re-running drops nothing destructive; create-table is
-- guarded; refresh function is create-or-replace; the orchestrator is
-- redefined in full to add the new perform call.

-- 1. New monthly snapshot table
create table if not exists public.brreg_snapshot_founder_age_monthly (
  reg_month            date not null,
  is_ai_relevant       boolean not null,
  median_youngest_age  numeric(5,1),
  p25_youngest_age     numeric(5,1),
  p75_youngest_age     numeric(5,1),
  sample_size          int not null,
  primary key (reg_month, is_ai_relevant)
);

alter table public.brreg_snapshot_founder_age_monthly enable row level security;

drop policy if exists brreg_snapshot_founder_age_monthly_public_read
  on public.brreg_snapshot_founder_age_monthly;
create policy brreg_snapshot_founder_age_monthly_public_read
  on public.brreg_snapshot_founder_age_monthly for select using (true);

-- 2. Refresh function — same percentile_cont aggregation as yearly,
--    grouped by date_trunc('month', registrert_dato).
create or replace function public.refresh_brreg_snapshot_founder_age_monthly()
  returns void language plpgsql security definer set search_path = public as $$
begin
  truncate table public.brreg_snapshot_founder_age_monthly;
  insert into public.brreg_snapshot_founder_age_monthly
    (reg_month, is_ai_relevant, median_youngest_age,
     p25_youngest_age, p75_youngest_age, sample_size)
  select
    date_trunc('month', registrert_dato)::date as reg_month,
    is_ai_relevant,
    percentile_cont(0.5)  within group (order by youngest_role_age_at_reg)::numeric(5,1),
    percentile_cont(0.25) within group (order by youngest_role_age_at_reg)::numeric(5,1),
    percentile_cont(0.75) within group (order by youngest_role_age_at_reg)::numeric(5,1),
    count(*)
  from public.brreg_companies
  where registrert_dato is not null
    and registrert_dato >= date '2018-01-01'
    and youngest_role_age_at_reg is not null
  group by 1, 2;
end;
$$;

-- 3. Orchestrator update — preserves the 10-min statement_timeout from 0042
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
  perform public.refresh_brreg_snapshot_headline();
end;
$$;
