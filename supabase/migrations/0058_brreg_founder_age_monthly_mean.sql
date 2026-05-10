-- 0058_brreg_founder_age_monthly_mean.sql
--
-- Switches the /oppstart "alder ved registrering" chart from median to
-- mean. Founder ages span a narrow band (~20–70) with no extreme
-- outliers, so the arithmetic mean is more intuitive than the median.
-- IQR (p25/p75) is replaced by the standard deviation — same unit as
-- the mean (years), so the tooltip can read "32,4 år · ± 4,1 år · n = 217".
--
-- Idempotent — column adds/drops are guarded; the refresh function is
-- create-or-replace; the snapshot is repopulated at the bottom so the
-- table is in sync with the new schema before the next 04:45 cron tick.
--
-- Yearly snapshot (0048) is unaffected — /oppstart no longer reads it.

-- 1. Schema: add mean + stddev columns, drop median + p25/p75.
alter table public.brreg_snapshot_founder_age_monthly
  add column if not exists mean_youngest_age   numeric(5,1);
alter table public.brreg_snapshot_founder_age_monthly
  add column if not exists stddev_youngest_age numeric(5,1);
alter table public.brreg_snapshot_founder_age_monthly
  drop column if exists median_youngest_age;
alter table public.brreg_snapshot_founder_age_monthly
  drop column if exists p25_youngest_age;
alter table public.brreg_snapshot_founder_age_monthly
  drop column if exists p75_youngest_age;

-- 2. Refresh function — same shape as 0051's, but with avg() + stddev()
--    in place of percentile_cont(0.5) / 0.25 / 0.75. Postgres `stddev`
--    is `stddev_samp` and returns NULL when count(*) = 1; the chart's
--    tooltip already null-guards the spread display.
create or replace function public.refresh_brreg_snapshot_founder_age_monthly()
  returns void language plpgsql security definer set search_path = public as $$
begin
  truncate table public.brreg_snapshot_founder_age_monthly;
  insert into public.brreg_snapshot_founder_age_monthly
    (reg_month, is_ai_relevant, mean_youngest_age,
     stddev_youngest_age, sample_size)
  select
    date_trunc('month', registrert_dato)::date as reg_month,
    is_ai_relevant,
    avg(youngest_role_age_at_reg)::numeric(5,1),
    stddev(youngest_role_age_at_reg)::numeric(5,1),
    count(*)
  from public.brreg_companies
  where registrert_dato is not null
    and registrert_dato >= date '2018-01-01'
    and youngest_role_age_at_reg is not null
  group by 1, 2;
end;
$$;

-- 3. Repopulate immediately so the API serves mean/stddev rows without
--    waiting on the 04:45 brreg-refresh-snapshots cron tick.
select public.refresh_brreg_snapshot_founder_age_monthly();
