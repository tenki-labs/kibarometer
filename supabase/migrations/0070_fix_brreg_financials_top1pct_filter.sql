-- 0070_fix_brreg_financials_top1pct_filter.sql
-- Fix latent bug in refresh_brreg_snapshot_financials_yearly() from 0064.
--
-- The original top1pct_sum expression nested max(n) inside a FILTER
-- predicate:
--
--   sum(revenue) filter (where rank_desc <= greatest(1, max(n) / 100))
--
-- Postgres rejects aggregate-in-FILTER at execution time, so
-- refresh_all_brreg_snapshots() has been failing since 0064 deployed
-- (the bug stays latent until the function actually runs — plpgsql
-- accepts the body at create time without semantic validation).
--
-- Fix: n is already a window column in the `ranked` CTE
-- (count(*) over (partition by fiscal_year, is_ai_relevant)), constant
-- within each group. FILTER predicates evaluate row-by-row before
-- grouping, so we can reference n directly without an aggregate wrapper.
--
-- Idempotent: CREATE OR REPLACE FUNCTION. Signature unchanged.

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
    -- Gini math runs in numeric throughout. The baseline group can hit
    -- ~500k rows × ~1e12 NOK revenues — the inner sum(rank_asc * revenue)
    -- and the (n+1)*total term both overflow bigint without explicit casts.
    select
      fiscal_year, is_ai_relevant,
      max(n) as n,
      max(group_total) as group_total,
      (2::numeric * sum(rank_asc::numeric * revenue::numeric)
         - (max(n)::numeric + 1) * max(group_total)::numeric)
        / nullif(max(n)::numeric * max(group_total)::numeric, 0) as gini,
      sum(revenue) filter (where rank_desc <= 10) as top10_sum,
      sum(revenue) filter (where rank_desc <= greatest(1, n / 100)) as top1pct_sum
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
