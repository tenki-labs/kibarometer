-- 0049_fix_refresh_snapshot_keywords.sql
-- Fix `more than one row returned by a subquery used as an expression` in
-- refresh_snapshot_keywords(). Two real-world conditions trip the prior
-- version (introduced by 0022 to switch is_active → status='canonical'):
--
--   1. Same-term-multi-domain rows. A term may legitimately exist as
--      domain=jobs AND domain=any (or media/brreg) with the same status.
--      The 0022 `active` CTE pulls every domain, so the IN-list and the
--      scalar subquery both see duplicates.
--   2. Same-term-multi-category rows (data-quality drift). At time of
--      writing this happens for `RAG`: status=canonical, domain=jobs, but
--      two rows with category in (concept, tool). The scalar subquery
--      `(select category from active a where a.term = c.kw)` then
--      returns 2 rows and the whole RPC blows up.
--
-- Fix: aggregate `active` by term, picking min(category) deterministically,
-- and restrict to keywords actually relevant to the NAV pipeline (domain
-- in ('jobs','any'); the matcher itself only loads those, so any other
-- domain term in `active` is dead weight). Same body otherwise.
--
-- Idempotent: pure CREATE OR REPLACE, no schema change, no data migration.

create or replace function public.refresh_snapshot_keywords() returns void
language plpgsql security definer set search_path = public as $$
begin
  truncate table public.snapshot_keywords;
  with active as (
    select term, min(category) as category
      from public.keywords
     where status = 'canonical'
       and domain in ('jobs', 'any')
     group by term
  ),
  current_window as (
    select kw, count(*) as n
    from public.nav_postings, unnest(matched_keywords) as kw
    where is_ai
      and posted_at >= now() - interval '30 days'
      and kw in (select term from active)
    group by kw
  ),
  prior_window as (
    select kw, count(*) as n
    from public.nav_postings, unnest(matched_keywords) as kw
    where is_ai
      and posted_at >= now() - interval '395 days'
      and posted_at <  now() - interval '365 days'
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
  insert into public.snapshot_keywords (keyword, category, ai_count_30d, ai_count_30d_yoy, yoy_growth_pct, rank)
  select keyword, category, ai_count_30d, ai_count_30d_yoy, yoy_growth_pct,
         row_number() over (order by ai_count_30d desc, keyword)::int as rank
  from joined;
end;
$$;