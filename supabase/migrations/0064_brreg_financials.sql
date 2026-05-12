-- 0064_brreg_financials.sql
-- Layer Regnskapsregisteret annual financials on top of brreg_companies.
-- Source: data.brreg.no/regnskapsregisteret/regnskap/{orgnr} (NLOD 2.0).
-- Returns one JSON object per filed årsregnskap (annual report); we keep
-- one row per (orgnr, fiscal_year). Small AS below regnskapsplikt threshold
-- and ENK won't file — that's a known coverage gap, documented in
-- /docs/oppstart.
--
-- Three reading surfaces:
--   1. /admin/startups/financials inspector (drain progress + counts).
--   2. /oppstart public segments:
--      - "Variansen i AI-økonomien" (Lorenz curve + Gini + top-10 share)
--      - "Omsetning over tid" (indexed line chart AI vs baseline)
--      - "Hvor mange overlever?" (cohort cards grid)
--   3. (future) D3 cross-pillar momentum quadrant — joins on orgnr.
--
-- Two new snapshot tables and one fetch-attempt tracker. Wires both
-- refresh functions into refresh_all_brreg_snapshots() so the nightly
-- 04:45 UTC tick from kiba-fetcher recomputes them alongside the
-- existing brreg snapshots.
--
-- Idempotent.

-- ============================================================
-- 1. brreg_financials — one row per (orgnr, fiscal_year).
--    Cascades on company delete so a slettet entity that gets pruned
--    elsewhere doesn't leave dangling financials.
-- ============================================================

create table if not exists public.brreg_financials (
  orgnr text not null references public.brreg_companies(orgnr) on delete cascade,
  fiscal_year int not null,
  -- Reporting period bounds. Most filings are calendar-year, but a
  -- minority use offset fiscal years; we store both so analytics can
  -- normalise if needed.
  regnskapsperiode_fra date,
  regnskapsperiode_til date,
  valuta text,
  -- NOK values. Bigint covers up to 9.2 quintillion — far above the
  -- largest Norwegian companies' balance-sheet totals.
  sum_driftsinntekter bigint,           -- omsetning / revenue
  driftsresultat bigint,                -- operating profit
  ordinaert_resultat_for_skatt bigint,
  aarsresultat bigint,                  -- net income
  sum_eiendeler bigint,                 -- total assets
  sum_egenkapital bigint,
  sum_gjeld bigint,
  gjennomsnittlig_antall_ansatte int,
  fetched_at timestamptz not null default now(),
  -- Full source row from Regnskapsregisteret, kept so we can re-derive
  -- column-level numbers when their JSON shape changes (matches the
  -- raw_jsonb pattern in brreg_companies).
  raw_jsonb jsonb,
  primary key (orgnr, fiscal_year)
);

create index if not exists brreg_financials_year_idx
  on public.brreg_financials (fiscal_year);

create index if not exists brreg_financials_year_revenue_idx
  on public.brreg_financials (fiscal_year, sum_driftsinntekter desc nulls last);

alter table public.brreg_financials enable row level security;

-- Public reads go through the snapshot tables. The base table is staff-only
-- so /admin/startups/financials can browse individual orgnr filings.
drop policy if exists brreg_financials_staff_read on public.brreg_financials;
create policy brreg_financials_staff_read on public.brreg_financials
  for select using (public.is_staff());

-- ============================================================
-- 2. brreg_financials_fetch_state — one row per orgnr we've ever
--    attempted to fetch. Lives separately from brreg_financials so a
--    company with zero filings still gets a recorded attempt (and
--    doesn't keep getting retried every tick).
-- ============================================================

create table if not exists public.brreg_financials_fetch_state (
  orgnr text primary key references public.brreg_companies(orgnr) on delete cascade,
  last_fetch_attempt_at timestamptz not null default now(),
  last_fetch_status text not null check (last_fetch_status in ('OK','NO_FILINGS','HTTP_ERROR')),
  last_fetch_error text,
  attempts int not null default 1
);

-- Drain candidate index: rows due for next fetch ordered by last_fetch_attempt_at.
create index if not exists brreg_financials_fetch_state_due_idx
  on public.brreg_financials_fetch_state (last_fetch_attempt_at);

alter table public.brreg_financials_fetch_state enable row level security;

drop policy if exists brreg_financials_fetch_state_staff_read on public.brreg_financials_fetch_state;
create policy brreg_financials_fetch_state_staff_read on public.brreg_financials_fetch_state
  for select using (public.is_staff());

-- ============================================================
-- 3. brreg_snapshot_financials_yearly — per-year aggregates split by
--    is_ai_relevant. Powers Segment 1 (Pareto / variance) and Segment 2
--    (revenue growth, AI vs baseline) on /oppstart.
-- ============================================================

create table if not exists public.brreg_snapshot_financials_yearly (
  fiscal_year int not null,
  is_ai_relevant boolean not null,
  company_count int not null,
  sum_omsetning bigint not null,           -- total NOK revenue this year × subset
  p25_omsetning bigint,
  median_omsetning bigint,
  p75_omsetning bigint,
  p90_omsetning bigint,
  p99_omsetning bigint,
  mean_omsetning bigint,
  -- Concentration metrics.
  gini_omsetning numeric(6,4),             -- 0..1 (1 = perfect inequality)
  top10_share numeric(6,4),                -- top 10 companies / total revenue
  top1pct_share numeric(6,4),              -- top 1% of companies (greatest(1, n/100))
  -- Productivity proxy.
  mean_revenue_per_employee bigint,
  -- Lorenz-curve points for Segment 1's variance visualisation. JSON
  -- array of [x, y] tuples (both 0..1), with 20 evenly-spaced ventiles
  -- plus a synthetic origin at [0, 0]. y = cumulative share of revenue,
  -- x = cumulative share of companies (sorted by revenue ascending).
  lorenz_points jsonb,
  primary key (fiscal_year, is_ai_relevant)
);

alter table public.brreg_snapshot_financials_yearly enable row level security;
drop policy if exists brreg_snapshot_financials_yearly_public_read
  on public.brreg_snapshot_financials_yearly;
create policy brreg_snapshot_financials_yearly_public_read
  on public.brreg_snapshot_financials_yearly for select using (true);

-- ============================================================
-- 4. brreg_snapshot_financials_cohort — one row per
--    (cohort_year, is_ai_relevant). Powers Segment 3 (cohort cards).
--    observation_year is computed once at refresh time: the most recent
--    fiscal year with at least 100 filings, so cards reflect the latest
--    complete data without mixing partial years.
-- ============================================================

create table if not exists public.brreg_snapshot_financials_cohort (
  cohort_year int not null,
  is_ai_relevant boolean not null,
  observation_year int not null,
  cohort_size int not null,                  -- companies founded in cohort_year
  alive_count int not null,                  -- not slettet, not konkurs at refresh
  filing_positive_count int not null,        -- filed positive omsetning in observation_year
  median_revenue_filing bigint,              -- among filing_positive
  mean_revenue_per_employee_filing bigint,
  -- Top performer in (cohort_year, is_ai_relevant) by observation_year revenue.
  top_performer_orgnr text,
  top_performer_name text,
  top_performer_revenue bigint,
  primary key (cohort_year, is_ai_relevant)
);

alter table public.brreg_snapshot_financials_cohort enable row level security;
drop policy if exists brreg_snapshot_financials_cohort_public_read
  on public.brreg_snapshot_financials_cohort;
create policy brreg_snapshot_financials_cohort_public_read
  on public.brreg_snapshot_financials_cohort for select using (true);

-- ============================================================
-- 5. refresh_brreg_snapshot_financials_yearly() — truncate + insert.
--    Computes Gini via the closed-form formula
--    G = (2 * sum(i * x_i) - (n + 1) * total) / (n * total)
--    when x is sorted ascending and i runs 1..n. Top-decile and
--    top-1pct shares use rank_desc-based filter sums.
-- ============================================================

create or replace function public.refresh_brreg_snapshot_financials_yearly() returns void
language plpgsql security definer set search_path = public as $$
begin
  truncate table public.brreg_snapshot_financials_yearly;

  insert into public.brreg_snapshot_financials_yearly (
    fiscal_year, is_ai_relevant, company_count, sum_omsetning,
    p25_omsetning, median_omsetning, p75_omsetning, p90_omsetning, p99_omsetning,
    mean_omsetning, gini_omsetning, top10_share, top1pct_share,
    mean_revenue_per_employee, lorenz_points
  )
  with src as (
    -- Only positive-revenue filings count toward the variance metrics.
    -- Zero / null / negative omsetning would distort Gini and percentile
    -- shape — surface them in admin inspector, exclude from public agg.
    select
      f.fiscal_year,
      c.is_ai_relevant,
      f.sum_driftsinntekter::bigint as revenue,
      f.gjennomsnittlig_antall_ansatte as ansatte
    from public.brreg_financials f
    join public.brreg_companies c on c.orgnr = f.orgnr
    where f.sum_driftsinntekter is not null
      and f.sum_driftsinntekter > 0
  ),
  ranked as (
    select
      fiscal_year, is_ai_relevant, revenue, ansatte,
      row_number() over (
        partition by fiscal_year, is_ai_relevant
        order by revenue
      ) as rank_asc,
      row_number() over (
        partition by fiscal_year, is_ai_relevant
        order by revenue desc
      ) as rank_desc,
      count(*) over (partition by fiscal_year, is_ai_relevant) as n,
      sum(revenue) over (partition by fiscal_year, is_ai_relevant) as group_total
    from src
  ),
  agg as (
    select
      fiscal_year, is_ai_relevant,
      max(n) as n,
      max(group_total) as group_total,
      (2 * sum(rank_asc * revenue) - (max(n) + 1) * max(group_total))::numeric
        / nullif(max(n)::numeric * max(group_total), 0) as gini,
      sum(revenue) filter (where rank_desc <= 10) as top10_sum,
      sum(revenue) filter (where rank_desc <= greatest(1, max(n) / 100)) as top1pct_sum
    from ranked
    group by fiscal_year, is_ai_relevant
  ),
  percentiles as (
    select
      fiscal_year, is_ai_relevant,
      percentile_cont(0.25) within group (order by revenue) as p25,
      percentile_cont(0.50) within group (order by revenue) as median,
      percentile_cont(0.75) within group (order by revenue) as p75,
      percentile_cont(0.90) within group (order by revenue) as p90,
      percentile_cont(0.99) within group (order by revenue) as p99,
      avg(revenue) as mean_rev,
      avg(revenue::numeric / nullif(ansatte, 0))
        filter (where ansatte is not null and ansatte > 0) as mean_rev_per_emp
    from src
    group by fiscal_year, is_ai_relevant
  ),
  lorenz_pts as (
    -- Compute 20 ventile boundaries + the origin per (fiscal_year, is_ai_relevant).
    -- For each ventile we take the row at the bucket's upper edge to read its
    -- cumulative-share-of-revenue and cumulative-share-of-companies.
    select
      fiscal_year, is_ai_relevant,
      jsonb_agg(
        jsonb_build_array(round(x_val::numeric, 4), round(y_val::numeric, 4))
        order by x_val
      ) as pts
    from (
      -- Origin point [0, 0]: cumulative share at the start.
      select fiscal_year, is_ai_relevant, 0::numeric as x_val, 0::numeric as y_val
        from src
        group by fiscal_year, is_ai_relevant
      union all
      -- 20 ventile boundary points. NTILE buckets the rows into 1..20 by
      -- revenue ascending; the last row of each bucket gives us the
      -- cumulative position at that ventile boundary.
      select fiscal_year, is_ai_relevant, x_val, y_val from (
        select
          fiscal_year, is_ai_relevant, bucket, rn, n, cum_rev, group_total_inner,
          (rn::numeric / n) as x_val,
          (cum_rev::numeric / nullif(group_total_inner, 0)) as y_val,
          row_number() over (
            partition by fiscal_year, is_ai_relevant, bucket
            order by rn desc
          ) as is_last_in_bucket
        from (
          select
            fiscal_year, is_ai_relevant, revenue,
            row_number() over (
              partition by fiscal_year, is_ai_relevant order by revenue
            ) as rn,
            count(*) over (partition by fiscal_year, is_ai_relevant) as n,
            sum(revenue) over (
              partition by fiscal_year, is_ai_relevant order by revenue
              rows between unbounded preceding and current row
            ) as cum_rev,
            sum(revenue) over (partition by fiscal_year, is_ai_relevant) as group_total_inner,
            ntile(20) over (
              partition by fiscal_year, is_ai_relevant order by revenue
            ) as bucket
          from src
        ) ranked_inner
      ) bucketed
      where is_last_in_bucket = 1
    ) all_pts
    group by fiscal_year, is_ai_relevant
  )
  select
    a.fiscal_year,
    a.is_ai_relevant,
    a.n,
    a.group_total,
    p.p25::bigint,
    p.median::bigint,
    p.p75::bigint,
    p.p90::bigint,
    p.p99::bigint,
    p.mean_rev::bigint,
    round(a.gini, 4),
    round((a.top10_sum::numeric / nullif(a.group_total, 0)), 4),
    round((a.top1pct_sum::numeric / nullif(a.group_total, 0)), 4),
    p.mean_rev_per_emp::bigint,
    lp.pts
  from agg a
  join percentiles p
    on p.fiscal_year = a.fiscal_year
   and p.is_ai_relevant = a.is_ai_relevant
  left join lorenz_pts lp
    on lp.fiscal_year = a.fiscal_year
   and lp.is_ai_relevant = a.is_ai_relevant;
end;
$$;

-- ============================================================
-- 6. refresh_brreg_snapshot_financials_cohort() — cohort cards.
--    observation_year resolves to the latest fiscal_year with ≥100
--    filings; cohorts span (observation_year - 7) .. (observation_year - 1)
--    so we get 7 cards from "1 year old" through "7 years old", which
--    fits the segment's horizontal grid without sprawling.
-- ============================================================

create or replace function public.refresh_brreg_snapshot_financials_cohort() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_observation_year int;
begin
  -- Pick the latest fiscal_year with broad enough coverage to be
  -- meaningful. NULL means we haven't backfilled enough yet — leave
  -- the snapshot empty and let the public component render an empty
  -- state.
  select max(fiscal_year) into v_observation_year
    from (
      select fiscal_year
        from public.brreg_financials
        where sum_driftsinntekter is not null
        group by fiscal_year
        having count(*) >= 100
    ) eligible;

  truncate table public.brreg_snapshot_financials_cohort;

  if v_observation_year is null then
    return;
  end if;

  insert into public.brreg_snapshot_financials_cohort (
    cohort_year, is_ai_relevant, observation_year,
    cohort_size, alive_count, filing_positive_count,
    median_revenue_filing, mean_revenue_per_employee_filing,
    top_performer_orgnr, top_performer_name, top_performer_revenue
  )
  with cohort as (
    select
      bc.orgnr, bc.navn, bc.is_ai_relevant, bc.konkurs, bc.slettet_dato,
      extract(year from bc.registrert_dato)::int as cohort_year
    from public.brreg_companies bc
    where bc.registrert_dato is not null
      and extract(year from bc.registrert_dato)::int
            between v_observation_year - 7 and v_observation_year - 1
  ),
  with_financials as (
    select
      c.cohort_year, c.is_ai_relevant, c.orgnr, c.navn,
      c.slettet_dato, c.konkurs,
      f.sum_driftsinntekter::bigint as obs_revenue,
      f.gjennomsnittlig_antall_ansatte as obs_ansatte
    from cohort c
    left join public.brreg_financials f
      on f.orgnr = c.orgnr and f.fiscal_year = v_observation_year
  ),
  top_perf as (
    select distinct on (cohort_year, is_ai_relevant)
      cohort_year, is_ai_relevant, orgnr, navn, obs_revenue
    from with_financials
    where obs_revenue is not null and obs_revenue > 0
    order by cohort_year, is_ai_relevant, obs_revenue desc
  ),
  rolled_up as (
    select
      cohort_year,
      is_ai_relevant,
      count(*) as cohort_size,
      count(*) filter (where slettet_dato is null and not konkurs) as alive_count,
      count(*) filter (where obs_revenue is not null and obs_revenue > 0)
        as filing_positive_count,
      percentile_cont(0.50) within group (
        order by case when obs_revenue is not null and obs_revenue > 0 then obs_revenue end
      ) as median_rev,
      avg(obs_revenue::numeric / nullif(obs_ansatte, 0))
        filter (where obs_revenue is not null and obs_revenue > 0
                  and obs_ansatte is not null and obs_ansatte > 0) as mean_rev_per_emp
    from with_financials
    group by cohort_year, is_ai_relevant
  )
  select
    r.cohort_year,
    r.is_ai_relevant,
    v_observation_year,
    r.cohort_size,
    r.alive_count,
    r.filing_positive_count,
    r.median_rev::bigint,
    r.mean_rev_per_emp::bigint,
    tp.orgnr,
    tp.navn,
    tp.obs_revenue
  from rolled_up r
  left join top_perf tp
    on tp.cohort_year = r.cohort_year
   and tp.is_ai_relevant = r.is_ai_relevant;
end;
$$;

-- ============================================================
-- 7. Orchestrator update — extend the chain from 0052 to include the
--    two financials refreshes. Inserted before the headline so
--    headline-stage logic could reference financials data in a future
--    migration without re-ordering.
-- ============================================================

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
  perform public.refresh_brreg_snapshot_financials_yearly();
  perform public.refresh_brreg_snapshot_financials_cohort();
  perform public.refresh_brreg_snapshot_headline();
end;
$$;
