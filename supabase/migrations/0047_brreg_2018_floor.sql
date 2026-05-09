-- 0047_brreg_2018_floor.sql
--
-- Re-introduce the 2018-01-01 floor on brreg ingestion + snapshots.
-- 0033 deprecated the floor column and a backfill since loaded the full
-- Enhetsregisteret going back to 1995. Pre-2022 baseline is fine; 1995-2017
-- is irrelevant for measuring how AI changed the Norwegian startup scene.
--
-- This migration:
--   1. Restores app_settings.brreg_bootstrap_floor_date to '2018-01-01' as
--      the not-null default. Existing null rows get filled in.
--   2. Recreates every snapshot-refresh function in 0030 with a
--      registrert_dato >= '2018-01-01' floor for defence in depth.
--   3. One-time prunes brreg_companies of pre-2018 (and null-date) rows.
--      brreg_roles + brreg_url_queue cascade-delete via FK.
--
-- Idempotent — re-running is a no-op once the floor is in place and the
-- pre-2018 rows are gone.

-- 1. app_settings: restore default + not-null
update public.app_settings
   set brreg_bootstrap_floor_date = date '2018-01-01'
 where id = 1
   and brreg_bootstrap_floor_date is null;

alter table public.app_settings
  alter column brreg_bootstrap_floor_date set default date '2018-01-01';

alter table public.app_settings
  alter column brreg_bootstrap_floor_date set not null;

comment on column public.app_settings.brreg_bootstrap_floor_date is
  'Floor date for brreg backfill and snapshot aggregation. Re-introduced in 0047 after 0033 deprecation. Default 2018-01-01 to provide a multi-year pre-2022 baseline for AI-vs-non-AI comparisons.';

-- 2. Snapshot refresh functions — add the 2018 floor everywhere it
--    matters. geography and headline already date-window to the last
--    30/395 days; the floor is redundant there but harmless and keeps
--    the WHERE shape consistent across functions.

create or replace function public.refresh_brreg_snapshot_daily() returns void
language plpgsql security definer set search_path = public as $$
declare
  young_max smallint;
begin
  select coalesce(brreg_young_founder_age_max, 22) into young_max from public.app_settings where id = 1;

  truncate table public.brreg_snapshot_daily;
  insert into public.brreg_snapshot_daily (registrert_dato, nace_category_slug, count, ai_relevant_count, young_founder_count)
  select
    registrert_dato,
    coalesce(nace_category_slug, 'annet'),
    count(*),
    count(*) filter (where is_ai_relevant),
    count(*) filter (where youngest_role_age_at_reg is not null and youngest_role_age_at_reg < young_max)
  from public.brreg_companies
  where registrert_dato is not null
    and registrert_dato >= date '2018-01-01'
  group by registrert_dato, coalesce(nace_category_slug, 'annet');
end;
$$;

create or replace function public.refresh_brreg_snapshot_focus_daily() returns void
language plpgsql security definer set search_path = public as $$
declare
  young_max smallint;
begin
  select coalesce(brreg_young_founder_age_max, 22) into young_max from public.app_settings where id = 1;

  truncate table public.brreg_snapshot_focus_daily;
  insert into public.brreg_snapshot_focus_daily (
    registrert_dato, nace_category_slug, total, ai_relevant,
    age_under_23, age_23_29, age_30_39, age_40_49, age_50_plus, age_unknown
  )
  select
    c.registrert_dato,
    c.nace_category_slug,
    count(*),
    count(*) filter (where c.is_ai_relevant),
    count(*) filter (where c.youngest_role_age_at_reg < young_max),
    count(*) filter (where c.youngest_role_age_at_reg between young_max and 29),
    count(*) filter (where c.youngest_role_age_at_reg between 30 and 39),
    count(*) filter (where c.youngest_role_age_at_reg between 40 and 49),
    count(*) filter (where c.youngest_role_age_at_reg >= 50),
    count(*) filter (where c.youngest_role_age_at_reg is null)
  from public.brreg_companies c
  where c.registrert_dato is not null
    and c.registrert_dato >= date '2018-01-01'
    and c.nace_category_slug in (
      select distinct slug from public.nace_categories where enrich_roles
    )
  group by c.registrert_dato, c.nace_category_slug;
end;
$$;

create or replace function public.refresh_brreg_snapshot_cohort() returns void
language plpgsql security definer set search_path = public as $$
begin
  truncate table public.brreg_snapshot_cohort;
  insert into public.brreg_snapshot_cohort (
    cohort_quarter, is_ai_relevant,
    total_at_registration, still_active_count, slettet_count, konkurs_count,
    survival_rate_pct
  )
  select
    date_trunc('quarter', registrert_dato)::date as cohort_quarter,
    is_ai_relevant,
    count(*) as total_at_registration,
    count(*) filter (where slettet_dato is null and not konkurs) as still_active_count,
    count(*) filter (where slettet_dato is not null) as slettet_count,
    count(*) filter (where konkurs) as konkurs_count,
    case when count(*) = 0 then 0
         else round(
           (count(*) filter (where slettet_dato is null and not konkurs))::numeric
             / count(*) * 100, 2)
    end as survival_rate_pct
  from public.brreg_companies
  where registrert_dato is not null
    and registrert_dato >= date '2018-01-01'
  group by 1, 2;
end;
$$;

-- 3. One-time prune. Cascades to brreg_roles + brreg_url_queue.
delete from public.brreg_companies
 where registrert_dato is null
    or registrert_dato < date '2018-01-01';
