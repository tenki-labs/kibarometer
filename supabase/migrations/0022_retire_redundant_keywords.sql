-- 0022_retire_redundant_keywords.sql
-- Lean the keyword list now that LLM Tier 2 (PRs 1–9) owns skill-level
-- granularity via snapshot_skill_categories. The keyword list's job
-- collapses to: rough offline-resilient is_ai gate + public methodology
-- vocabulary. Anything subsumed by a shorter term in a compatible language
-- adds zero is_ai signal — \bAI\b already fires on "AI Engineer" because
-- the space is a word boundary, so the longer entry never flips a row the
-- shorter one wouldn't.
--
-- Retire 18 redundant entries from the 0006 seed by setting status='rejected'
-- (preserves the row so historical nav_postings.matched_keywords still
-- resolves for audit). Public read (0015 RLS) filters status='canonical' so
-- /metode drops these immediately.
--
-- Also patches refresh_snapshot_keywords(): the 0008 definition references
-- the is_active column that 0015 dropped, so it has been throwing at call
-- time since 0015 deployed (rolling back the whole refresh_all_snapshots()
-- transaction; snapshot_keywords frozen pre-0015). The fix is a one-token
-- swap to "where status = 'canonical'" — same windows, same ranking.
--
-- Idempotent.

update public.keywords
   set status = 'rejected'
 where status != 'rejected'
   and (term_norm, language) in (
     -- Subsumed by AI (en, word) — \bAI\b fires on space/hyphen boundaries
     ('ai engineer',                'en'),
     ('ai researcher',              'en'),
     ('ai product manager',         'en'),
     ('ai-ingeniør',                'no'),
     ('ai-forsker',                 'no'),
     ('ai-arkitekt',                'no'),
     ('vertex ai',                  'any'),
     ('generative ai',              'en'),
     ('generativ ai',               'no'),
     -- Subsumed by KI (no, word)
     ('ki-ingeniør',                'no'),
     ('ki-forsker',                 'no'),
     ('ki-arkitekt',                'no'),
     ('generativ ki',               'no'),
     -- Subsumed by ML (en, word)
     ('ml engineer',                'en'),
     ('azure ml',                   'any'),
     -- Subsumed by `machine learning` / `maskinlæring` (substring)
     ('machine learning engineer',  'en'),
     ('maskinlæringsingeniør',      'no'),
     -- Subsumed by `språkmodell` (substring)
     ('store språkmodeller',        'no')
   );

-- Patch refresh_snapshot_keywords to use the post-0015 status column.
-- Same body as 0008's definition with `where is_active` → `where status =
-- 'canonical'`. Trial keywords stay excluded from public stats per the
-- original 0008 intent (snapshot drives public-facing chart).
create or replace function public.refresh_snapshot_keywords() returns void
language plpgsql security definer set search_path = public as $$
begin
  truncate table public.snapshot_keywords;
  with active as (
    select term, category from public.keywords where status = 'canonical'
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
