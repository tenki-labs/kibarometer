-- 0048_brreg_founder_age_yearly.sql
--
-- New snapshot powering the "Yngste grunnlegger ved registrering — AI vs
-- ikke-AI" segment on /oppstart (replacing the goldrush cohort-survival
-- chart in the UI). One row per (registration year, is_ai_relevant);
-- aggregates from public.brreg_companies using the youngest_role_age_at_reg
-- column populated by the role-enrichment pipeline.
--
-- The cohort snapshot table + refresh function are kept intact: the public
-- /api/v1/oppstart/snapshot endpoint serves them under _schema_version: 1.
-- This migration is additive only.
--
-- Idempotent — re-running drops nothing destructive; create-table is
-- guarded; refresh function is create-or-replace; the orchestrator is
-- redefined in full to add the new perform call.

-- 1. New snapshot table
create table if not exists public.brreg_snapshot_founder_age_yearly (
  reg_year             int not null,
  is_ai_relevant       boolean not null,
  median_youngest_age  numeric(5,1),
  p25_youngest_age     numeric(5,1),
  p75_youngest_age     numeric(5,1),
  sample_size          int not null,
  primary key (reg_year, is_ai_relevant)
);

alter table public.brreg_snapshot_founder_age_yearly enable row level security;

drop policy if exists brreg_snapshot_founder_age_yearly_public_read
  on public.brreg_snapshot_founder_age_yearly;
create policy brreg_snapshot_founder_age_yearly_public_read
  on public.brreg_snapshot_founder_age_yearly for select using (true);

-- 2. Refresh function
create or replace function public.refresh_brreg_snapshot_founder_age_yearly()
  returns void language plpgsql security definer set search_path = public as $$
begin
  truncate table public.brreg_snapshot_founder_age_yearly;
  insert into public.brreg_snapshot_founder_age_yearly
    (reg_year, is_ai_relevant, median_youngest_age,
     p25_youngest_age, p75_youngest_age, sample_size)
  select
    extract(year from registrert_dato)::int as reg_year,
    is_ai_relevant,
    percentile_cont(0.5) within group (order by youngest_role_age_at_reg)::numeric(5,1),
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
  perform public.refresh_brreg_snapshot_headline();
end;
$$;
