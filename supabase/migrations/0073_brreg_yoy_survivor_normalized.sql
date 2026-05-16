-- 0073_brreg_yoy_survivor_normalized.sql
--
-- Two corrections to public.refresh_brreg_snapshot_quarterly_ai_growth
-- (originally defined in 0065):
--
-- 1. Survivor-normalize both cohorts in the YoY comparison so the
--    headline % on /oppstart isn't mechanically inflated by the
--    survivorship bias that 0072_oppstart_methodology_survivor_bias
--    documented for the cohort-cards segment. Before this migration,
--    the current quarter's cohort had had ~weeks to dissolve while
--    the prior-year cohort had had a full year — and 0065 counted
--    "currently alive" for both, so the older cohort's denominator
--    was systematically smaller than its true count. With a real
--    YoY of 50 %, a 10 % dissolution gap shows as ~67 % — exactly
--    the inflation pattern that prompted the headline-trust review.
--
--    Fix: for each cohort q, count only companies still alive at
--    `q_end + (current_date - latest_complete_quarter_end)` — i.e.,
--    censor every cohort at the same elapsed age. The latest cohort's
--    censor evaluates to `current_date` (today), so its count is
--    unchanged. Prior-year cohorts are censored at their own
--    quarter_end + that same offset, giving an apples-to-apples
--    comparison among the data we have.
--
-- 2. Correct the comment in 0065 that promised a "weekly retag cron,
--    Sun 03:50 UTC". No such cron exists in scripts/fetcher-crontab;
--    only NAV and /offentlig have weekly retag scheduling. BRREG has
--    only the manual `Reprosesser nøkkelord` button on /admin/startups
--    (wired via lib/admin/legacy/brreg-reprocess.js). Documented
--    here so future readers don't trust the stale claim.
--
-- Caveat NOT addressed by this migration: cohorts older than the
-- bootstrap date (spring 2026) still suffer from the bootstrap-day
-- survivorship that 0072 documents — companies registered before
-- spring 2026 and dissolved before the bulk-dump ingest are absent
-- from brreg_companies entirely. Survivor-normalization at a uniform
-- elapsed-age cannot recover them. For YoY rows comparing two
-- pre-bootstrap quarters (e.g., Q1 2025 vs Q1 2024) this still
-- produces a biased number; flag any cite-able usage accordingly.
--
-- Idempotent. `create or replace function` is the standard pattern
-- for migrating PL/pgSQL bodies forward without dropping dependants.
-- Snapshot table public.brreg_snapshot_quarterly_ai_growth from 0065
-- is unchanged; only the refresh function body is replaced.

create or replace function public.refresh_brreg_snapshot_quarterly_ai_growth()
returns void language plpgsql security definer
set search_path = public as $$
begin
  truncate table public.brreg_snapshot_quarterly_ai_growth;
  insert into public.brreg_snapshot_quarterly_ai_growth
    (reg_quarter, ai_count, ai_count_yoy_prior, yoy_growth_pct)
  with horizon as (
    -- cur_q_start  = start of the in-progress quarter (excluded from
    --                the snapshot below).
    -- elapsed_days = how many days into the in-progress quarter we
    --                are. The latest *complete* cohort in the
    --                snapshot is therefore `elapsed_days` old (since
    --                its quarter end = cur_q_start). Every cohort
    --                gets censored at the same elapsed age.
    select date_trunc('quarter', current_date)::date as cur_q_start,
           (current_date - date_trunc('quarter', current_date)::date)::int
             as elapsed_days
  ),
  q as (
    select date_trunc('quarter', bc.registrert_dato)::date as reg_quarter,
           count(*) filter (
             where bc.is_ai_relevant
               and (
                 bc.slettet_dato is null
                 or bc.slettet_dato > (
                   (date_trunc('quarter', bc.registrert_dato)::date
                      + interval '3 months')::date
                   + make_interval(days => h.elapsed_days)
                 )::date
               )
           ) as ai_count
    from public.brreg_companies bc
    cross join horizon h
    where bc.registrert_dato is not null
      and bc.registrert_dato >= date '2018-01-01'
      and bc.registrert_dato <  h.cur_q_start
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
