-- 0027_snapshot_categories_daily.sql
-- Per-day flow snapshots split by NAV occupation `category` and by AI sub-cat
-- `slug`. Drives the two stacked-area charts on /jobbmarked: occupation
-- breakdown over time (segment 2, with AI pinned to the bottom band) and AI
-- sub-cat breakdown over time (segment 3).
--
-- Existing snapshot_category / snapshot_skill_categories are current-only
-- (rolling 30d snapshots). They can't drive a time-series. These two new
-- tables follow the same shape as snapshot_daily (0008): per (posted_on, key)
-- counts, full history, truncate+insert refresh.
--
-- Idempotent.

create table if not exists public.snapshot_category_daily (
  posted_on date not null,
  category text not null,
  ai_count int not null,
  total_count int not null,
  primary key (posted_on, category)
);

create table if not exists public.snapshot_skill_category_daily (
  posted_on date not null,
  slug text not null,
  ai_count int not null,
  primary key (posted_on, slug)
);

alter table public.snapshot_category_daily       enable row level security;
alter table public.snapshot_skill_category_daily enable row level security;

drop policy if exists snapshot_category_daily_public_read       on public.snapshot_category_daily;
drop policy if exists snapshot_skill_category_daily_public_read on public.snapshot_skill_category_daily;

create policy snapshot_category_daily_public_read
  on public.snapshot_category_daily for select using (true);
create policy snapshot_skill_category_daily_public_read
  on public.snapshot_skill_category_daily for select using (true);

-- Per-day flow by NAV `category` (level1 yrkeskategori). Same truncate+insert
-- pattern as refresh_snapshot_daily. Only counts postings with both posted_at
-- and category populated (i.e. enriched rows).
create or replace function public.refresh_snapshot_category_daily() returns void
language plpgsql security definer set search_path = public as $$
begin
  truncate table public.snapshot_category_daily;
  insert into public.snapshot_category_daily (posted_on, category, ai_count, total_count)
  select
    posted_at::date,
    category,
    count(*) filter (where is_ai),
    count(*)
  from public.nav_postings
  where posted_at is not null
    and category is not null
  group by posted_at::date, category;
end;
$$;

-- Per-day flow by AI sub-cat slug. Fans out llm_categories jsonb array via
-- jsonb_array_elements; counts distinct posting ids per (date, slug). A
-- posting can hit 1-3 sub-cats so per-slug counts may exceed total AI count.
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
  cross join lateral jsonb_array_elements(coalesce(p.llm_categories, '[]'::jsonb)) elem
  where p.is_ai = true
    and p.tier2_completed_at is not null
    and p.posted_at is not null
    and elem->>'slug' is not null
  group by p.posted_at::date, elem->>'slug';
end;
$$;

-- Extend the orchestrator. Re-defining is idempotent. We keep the original
-- six refreshes (refresh_snapshot_skill_categories is intentionally not in
-- here -- it runs from the LLM classification job, see lib/admin/legacy/
-- jobs.js) and append the two new daily refreshes.
create or replace function public.refresh_all_snapshots() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_snapshot_headline();
  perform public.refresh_snapshot_daily();
  perform public.refresh_snapshot_monthly();
  perform public.refresh_snapshot_keywords();
  perform public.refresh_snapshot_geography();
  perform public.refresh_snapshot_category();
  perform public.refresh_snapshot_category_daily();
  perform public.refresh_snapshot_skill_category_daily();
end;
$$;
