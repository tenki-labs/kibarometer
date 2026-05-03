-- 0021_skill_snapshot.sql
-- Public-read snapshot of AI-skill category counts, driven by Tier 2 LLM
-- classification (nav_postings.llm_categories jsonb). The home-page chart
-- reads this directly — same one-cheap-index-lookup pattern as the existing
-- snapshot_* tables from 0008_nav_snapshots.sql.
--
-- Numbered 0021 because 0019 was already taken (promote_keyword_candidate)
-- and 0020 by mlx_health when this migration shipped. The plan referenced
-- it as "0019_skill_snapshot.sql" but the file number is incidental — the
-- table name and refresh contract are what matters.
--
-- Retention: keyed by (computed_for, slug) with full history retained, just
-- like snapshot_headline. The home page reads "latest computed_for"; future
-- citation permalinks could pin to a date the same way ?as_of=YYYY-MM-DD
-- pins headline.
--
-- A posting can belong to 1–3 categories (Tier 2 returns up to 3), so the
-- per-slug counts may sum to more than the total classified postings. The
-- chart is "presence" not "exclusive distribution" — share_pct is the share
-- of *classified* postings that touch this slug, not a partition.
--
-- Idempotent.

create table if not exists public.snapshot_skill_categories (
  computed_for date not null,
  slug text not null,
  ai_count_30d int not null default 0,
  ai_count_7d int not null default 0,
  share_pct numeric,
  primary key (computed_for, slug)
);

alter table public.snapshot_skill_categories enable row level security;

drop policy if exists snapshot_skill_categories_public_read
  on public.snapshot_skill_categories;
create policy snapshot_skill_categories_public_read
  on public.snapshot_skill_categories for select using (true);

-- Refresh: one row per (today, slug) for every non-retired taxonomy slug.
-- Retired slugs intentionally drop out — historical rows for retired slugs
-- are kept for audit, but new computed_for dates only emit for live slugs.
create or replace function public.refresh_snapshot_skill_categories() returns void
language plpgsql security definer set search_path = public as $$
declare
  classified_30d int;
begin
  -- Denominator for share_pct: distinct AI postings classified in the last
  -- 30 days. Computed once so per-slug rows share the same base.
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
    cross join lateral jsonb_array_elements(coalesce(p.llm_categories, '[]'::jsonb)) elem
    where p.is_ai = true
      and p.tier2_completed_at is not null
      and p.posted_at >= now() - interval '30 days'
      and elem->>'slug' = cat.slug
  ) c30 on true
  left join lateral (
    select count(distinct p.id) as n
    from public.nav_postings p
    cross join lateral jsonb_array_elements(coalesce(p.llm_categories, '[]'::jsonb)) elem
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
