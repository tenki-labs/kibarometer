-- 0042_brreg_snapshot_timeout.sql
-- Lift the per-call statement timeout on the brreg snapshot refresh path.
--
-- Symptom: POST /rpc/refresh_all_brreg_snapshots returned 500 with
-- "canceling statement due to statement timeout". Each of the five sub-
-- functions full-scans public.brreg_companies, and the table has grown
-- past whatever the role-default statement_timeout is on this database.
--
-- Fix: add `set statement_timeout = '10min'` to every refresh function
-- defined in 0030_brreg.sql. Postgres applies the SET clause for the
-- function's call only and restores the previous value on return, so
-- this is scoped to the snapshot refresh and doesn't relax the timeout
-- for any other RPC. 10 minutes is generous for current scale yet still
-- bounded — a true runaway will surface as a timeout instead of hanging
-- the cron forever.
--
-- Bodies are unchanged from 0030_brreg.sql; only the SET clause is new.
-- Idempotent (`create or replace function`).

create or replace function public.refresh_brreg_snapshot_daily() returns void
language plpgsql security definer
set search_path = public
set statement_timeout = '10min'
as $$
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
  group by registrert_dato, coalesce(nace_category_slug, 'annet');
end;
$$;

create or replace function public.refresh_brreg_snapshot_geography() returns void
language plpgsql security definer
set search_path = public
set statement_timeout = '10min'
as $$
begin
  truncate table public.brreg_snapshot_geography;
  insert into public.brreg_snapshot_geography (fylke, count_30d, ai_relevant_count_30d, count_per_100k_30d)
  select
    fylke,
    count(*),
    count(*) filter (where is_ai_relevant),
    null
  from public.brreg_companies
  where fylke is not null
    and registrert_dato is not null
    and registrert_dato >= (current_date - interval '30 days')
  group by fylke;
end;
$$;

create or replace function public.refresh_brreg_snapshot_focus_daily() returns void
language plpgsql security definer
set search_path = public
set statement_timeout = '10min'
as $$
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
    and c.nace_category_slug in (
      select distinct slug from public.nace_categories where enrich_roles
    )
  group by c.registrert_dato, c.nace_category_slug;
end;
$$;

create or replace function public.refresh_brreg_snapshot_cohort() returns void
language plpgsql security definer
set search_path = public
set statement_timeout = '10min'
as $$
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
  group by 1, 2;
end;
$$;

create or replace function public.refresh_brreg_snapshot_headline() returns void
language plpgsql security definer
set search_path = public
set statement_timeout = '10min'
as $$
declare
  v_total_7d int;
  v_total_30d int;
  v_total_30d_yoy int;
  v_ai_count_30d int;
  v_it_30d int;
  v_kreativ_30d int;
  v_tjenester_30d int;
  v_as_ai int;
  v_enk_ai int;
  v_median_ai_as numeric(14,2);
  v_median_non_ai_as numeric(14,2);
  v_ai_count_curr_month int;
  v_ai_count_prev_month int;
  v_ai_count_curr_q int;
  v_ai_count_prev_q int;
  v_mom numeric;
  v_qoq numeric;
begin
  select
    count(*) filter (where registrert_dato >= current_date - interval '7 days'),
    count(*) filter (where registrert_dato >= current_date - interval '30 days'),
    count(*) filter (where registrert_dato >= current_date - interval '395 days'
                       and registrert_dato <  current_date - interval '365 days'),
    count(*) filter (where is_ai_relevant
                       and registrert_dato >= current_date - interval '30 days'),
    count(*) filter (where nace_category_slug = 'it'
                       and registrert_dato >= current_date - interval '30 days'),
    count(*) filter (where nace_category_slug = 'kreativ-media'
                       and registrert_dato >= current_date - interval '30 days'),
    count(*) filter (where nace_category_slug = 'tjenester'
                       and registrert_dato >= current_date - interval '30 days'),
    count(*) filter (where is_ai_relevant
                       and organisasjonsform = 'AS'
                       and registrert_dato >= current_date - interval '30 days'),
    count(*) filter (where is_ai_relevant
                       and organisasjonsform = 'ENK'
                       and registrert_dato >= current_date - interval '30 days')
  into
    v_total_7d, v_total_30d, v_total_30d_yoy, v_ai_count_30d,
    v_it_30d, v_kreativ_30d, v_tjenester_30d,
    v_as_ai, v_enk_ai
  from public.brreg_companies;

  select percentile_cont(0.5) within group (order by aksjekapital)
    into v_median_ai_as
    from public.brreg_companies
    where organisasjonsform = 'AS'
      and is_ai_relevant
      and aksjekapital is not null
      and registrert_dato >= current_date - interval '30 days';

  select percentile_cont(0.5) within group (order by aksjekapital)
    into v_median_non_ai_as
    from public.brreg_companies
    where organisasjonsform = 'AS'
      and not is_ai_relevant
      and aksjekapital is not null
      and registrert_dato >= current_date - interval '30 days';

  select
    count(*) filter (where is_ai_relevant
                       and registrert_dato >= date_trunc('month', current_date)::date),
    count(*) filter (where is_ai_relevant
                       and registrert_dato >= (date_trunc('month', current_date) - interval '1 month')::date
                       and registrert_dato <  date_trunc('month', current_date)::date),
    count(*) filter (where is_ai_relevant
                       and registrert_dato >= date_trunc('quarter', current_date)::date),
    count(*) filter (where is_ai_relevant
                       and registrert_dato >= (date_trunc('quarter', current_date) - interval '3 months')::date
                       and registrert_dato <  date_trunc('quarter', current_date)::date)
  into v_ai_count_curr_month, v_ai_count_prev_month, v_ai_count_curr_q, v_ai_count_prev_q
  from public.brreg_companies;

  v_mom := case when v_ai_count_prev_month = 0 then null
                else (v_ai_count_curr_month - v_ai_count_prev_month)::numeric / v_ai_count_prev_month
           end;
  v_qoq := case when v_ai_count_prev_q = 0 then null
                else (v_ai_count_curr_q - v_ai_count_prev_q)::numeric / v_ai_count_prev_q
           end;

  insert into public.brreg_snapshot_headline (
    computed_for, computed_at,
    total_7d, total_30d, total_30d_yoy,
    ai_relevant_count_30d, ai_relevant_share_30d,
    it_share_30d, kreativ_media_share_30d, tjenester_share_30d, enriched_combined_share_30d,
    as_share_of_ai_relevant_30d, enk_share_of_ai_relevant_30d,
    aksjekapital_median_ai_relevant_as_30d, aksjekapital_median_non_ai_as_30d,
    ai_relevant_mom_growth, ai_relevant_qoq_growth
  ) values (
    current_date, now(),
    v_total_7d, v_total_30d, v_total_30d_yoy,
    v_ai_count_30d,
    case when v_total_30d = 0 then 0 else round(v_ai_count_30d::numeric / v_total_30d, 5) end,
    case when v_total_30d = 0 then 0 else round(v_it_30d::numeric / v_total_30d, 5) end,
    case when v_total_30d = 0 then 0 else round(v_kreativ_30d::numeric / v_total_30d, 5) end,
    case when v_total_30d = 0 then 0 else round(v_tjenester_30d::numeric / v_total_30d, 5) end,
    case when v_total_30d = 0 then 0 else round((v_it_30d + v_kreativ_30d + v_tjenester_30d)::numeric / v_total_30d, 5) end,
    case when v_ai_count_30d = 0 then 0 else round(v_as_ai::numeric / v_ai_count_30d, 5) end,
    case when v_ai_count_30d = 0 then 0 else round(v_enk_ai::numeric / v_ai_count_30d, 5) end,
    v_median_ai_as,
    v_median_non_ai_as,
    v_mom,
    v_qoq
  )
  on conflict (computed_for) do update set
    computed_at                            = excluded.computed_at,
    total_7d                               = excluded.total_7d,
    total_30d                              = excluded.total_30d,
    total_30d_yoy                          = excluded.total_30d_yoy,
    ai_relevant_count_30d                  = excluded.ai_relevant_count_30d,
    ai_relevant_share_30d                  = excluded.ai_relevant_share_30d,
    it_share_30d                           = excluded.it_share_30d,
    kreativ_media_share_30d                = excluded.kreativ_media_share_30d,
    tjenester_share_30d                    = excluded.tjenester_share_30d,
    enriched_combined_share_30d            = excluded.enriched_combined_share_30d,
    as_share_of_ai_relevant_30d            = excluded.as_share_of_ai_relevant_30d,
    enk_share_of_ai_relevant_30d           = excluded.enk_share_of_ai_relevant_30d,
    aksjekapital_median_ai_relevant_as_30d = excluded.aksjekapital_median_ai_relevant_as_30d,
    aksjekapital_median_non_ai_as_30d      = excluded.aksjekapital_median_non_ai_as_30d,
    ai_relevant_mom_growth                 = excluded.ai_relevant_mom_growth,
    ai_relevant_qoq_growth                 = excluded.ai_relevant_qoq_growth;
end;
$$;

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
  perform public.refresh_brreg_snapshot_headline();
end;
$$;
