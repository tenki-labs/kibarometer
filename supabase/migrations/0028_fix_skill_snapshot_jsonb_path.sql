-- 0028_fix_skill_snapshot_jsonb_path.sql
-- Fix `cannot extract elements from an object` (PostgREST 400) thrown by
-- refresh_all_snapshots(). Two refresh functions assumed
-- nav_postings.llm_categories was a top-level JSONB array, but the writer
-- (lib/admin/llm-classify.ts) actually persists an object:
--
--   { "categories": [...], "rationale": "...", "invalid_slugs_dropped": N }
--
-- jsonb_array_elements() can't unnest an object, so the function blew up.
-- Both functions need to address the inner `categories` array.
--
-- Affected:
--   * refresh_snapshot_skill_categories       (introduced in 0021, called
--                                              from lib/admin/legacy/jobs.js)
--   * refresh_snapshot_skill_category_daily   (introduced in 0027, called
--                                              from refresh_all_snapshots())
--
-- Idempotent: pure CREATE OR REPLACE, no schema change, no data migration.

create or replace function public.refresh_snapshot_skill_categories() returns void
language plpgsql security definer set search_path = public as $$
declare
  classified_30d int;
begin
  select count(*)::int into classified_30d
  from public.nav_postings
  where is_ai = true
    and tier2_completed_at is not null
    and posted_at >= now() - interval '30 days';

  insert into public.snapshot_skill_categories
    (computed_for, slug, ai_count_30d, ai_count_7d, share_pct)
  select
    current_date,
    cat.slug,
    coalesce(c30.n, 0)::int,
    coalesce(c7.n, 0)::int,
    case when classified_30d = 0 then null
         else round((coalesce(c30.n, 0)::numeric / classified_30d) * 100, 1)
    end
  from public.taxonomy_categories cat
  left join lateral (
    select count(distinct p.id) as n
    from public.nav_postings p
    cross join lateral jsonb_array_elements(coalesce(p.llm_categories->'categories', '[]'::jsonb)) elem
    where p.is_ai = true
      and p.tier2_completed_at is not null
      and p.posted_at >= now() - interval '30 days'
      and elem->>'slug' = cat.slug
  ) c30 on true
  left join lateral (
    select count(distinct p.id) as n
    from public.nav_postings p
    cross join lateral jsonb_array_elements(coalesce(p.llm_categories->'categories', '[]'::jsonb)) elem
    where p.is_ai = true
      and p.tier2_completed_at is not null
      and p.posted_at >= now() - interval '7 days'
      and elem->>'slug' = cat.slug
  ) c7 on true
  where cat.retired_at is null
  on conflict (computed_for, slug) do update set
    ai_count_30d = excluded.ai_count_30d,
    ai_count_7d  = excluded.ai_count_7d,
    share_pct    = excluded.share_pct;
end;
$$;

create or replace function public.refresh_snapshot_skill_category_daily() returns void
language plpgsql security definer set search_path = public as $$
begin
  truncate table public.snapshot_skill_category_daily;
  insert into public.snapshot_skill_category_daily (posted_on, slug, ai_count)
  select
    p.posted_at::date,
    elem->>'slug',
    count(distinct p.id)
  from public.nav_postings p
  cross join lateral jsonb_array_elements(coalesce(p.llm_categories->'categories', '[]'::jsonb)) elem
  where p.is_ai = true
    and p.tier2_completed_at is not null
    and p.posted_at is not null
    and elem->>'slug' is not null
  group by p.posted_at::date, elem->>'slug';
end;
$$;
