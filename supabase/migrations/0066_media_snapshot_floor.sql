-- 0066_media_snapshot_floor.sql
--
-- Floor the media snapshot refresh at published_at >= 2024-01-01. The
-- raw media_articles table keeps its pre-2024 rows (some outlets'
-- RSS/sitemap ingest reaches back to 2015), but the snapshot
-- aggregations stop emitting rows below the floor — so the public
-- /media page and any admin view that reads the snapshot tables sees
-- a clean 2024+ horizon.
--
-- Floor source of truth is duplicated:
--   * SQL  : the literal '2024-01-01' below.
--   * TS   : MEDIA_DATA_CUTOFF in app/(site)/_lib/media-cutoff.ts.
-- Both must agree. Bumping the floor means editing both — there's no
-- single source because the TS constant is a build-time string and the
-- SQL function lives in the db. If we ever want to drive this from
-- app_settings we can add a column there and read it via a (volatile)
-- subquery, but the cost of the duplication is one extra edit on
-- floor change which is rare.
--
-- The 7-day rolling window in refresh_media_snapshot_index has a
-- known seam at the floor: the first 6 days of 2024 have shorter
-- look-back windows because the join is also clamped at the floor.
-- Accepted edge effect — alternative is to over-read 2023-12-26+
-- which defeats the point of the floor.
--
-- refresh_media_anomaly_daily reads from media_snapshot_category_daily,
-- so it inherits the floor for free and is NOT redefined here.
--
-- Idempotent: every function is `create or replace`.

create or replace function public.refresh_media_snapshot_daily() returns void
language plpgsql security definer set search_path = public as $$
begin
  truncate table public.media_snapshot_daily;
  insert into public.media_snapshot_daily (published_on, source_id, total_count, ai_count, distinct_story_count)
  select
    published_at::date,
    source_id,
    count(*),
    count(*) filter (where is_ai_related),
    count(distinct coalesce(wire_cluster_id::text, id::text)) filter (where is_ai_related)
  from public.media_articles
  where published_at is not null
    and published_at >= timestamptz '2024-01-01'
    and deleted_at is null
  group by published_at::date, source_id;
end;
$$;

create or replace function public.refresh_media_snapshot_category_daily() returns void
language plpgsql security definer set search_path = public as $$
begin
  truncate table public.media_snapshot_category_daily;
  insert into public.media_snapshot_category_daily (published_on, category_slug, ai_count, distinct_story_count, temperature)
  select
    a.published_at::date,
    elem->>'slug' as category_slug,
    count(distinct a.id),
    count(distinct coalesce(a.wire_cluster_id::text, a.id::text)),
    avg(
      case a.llm_stance
        when 'alarmed'           then -1.0
        when 'critical'          then -0.5
        when 'neutral-explainer' then  0.0
        when 'policy-debate'     then  0.0
        when 'personal-story'    then  0.0
        when 'enthusiastic'      then  1.0
        else null
      end * a.llm_intensity
    )::real as temperature
  from public.media_articles a
  cross join lateral jsonb_array_elements(coalesce(a.llm_categories->'categories', '[]'::jsonb)) elem
  where a.is_ai_related = true
    and a.tier2_completed_at is not null
    and a.published_at is not null
    and a.published_at >= timestamptz '2024-01-01'
    and a.deleted_at is null
    and elem->>'slug' is not null
  group by a.published_at::date, elem->>'slug';
end;
$$;

create or replace function public.refresh_media_snapshot_source_category_daily() returns void
language plpgsql security definer set search_path = public as $$
begin
  truncate table public.media_snapshot_source_category_daily;
  insert into public.media_snapshot_source_category_daily (published_on, source_id, category_slug, ai_count, temperature)
  select
    a.published_at::date,
    a.source_id,
    elem->>'slug' as category_slug,
    count(distinct a.id),
    avg(
      case a.llm_stance
        when 'alarmed'           then -1.0
        when 'critical'          then -0.5
        when 'neutral-explainer' then  0.0
        when 'policy-debate'     then  0.0
        when 'personal-story'    then  0.0
        when 'enthusiastic'      then  1.0
        else null
      end * a.llm_intensity
    )::real as temperature
  from public.media_articles a
  cross join lateral jsonb_array_elements(coalesce(a.llm_categories->'categories', '[]'::jsonb)) elem
  where a.is_ai_related = true
    and a.tier2_completed_at is not null
    and a.published_at is not null
    and a.published_at >= timestamptz '2024-01-01'
    and a.deleted_at is null
    and elem->>'slug' is not null
  group by a.published_at::date, a.source_id, elem->>'slug';
end;
$$;

create or replace function public.refresh_media_snapshot_index() returns void
language plpgsql security definer set search_path = public as $$
begin
  truncate table public.media_snapshot_index;
  insert into public.media_snapshot_index (date, index_value, article_count_7d, ai_article_count_7d, categories_above_water, categories_below_water)
  with article_dates as (
    select distinct published_at::date as d
    from public.media_articles
    where published_at is not null
      and published_at >= timestamptz '2024-01-01'
      and deleted_at is null
  ),
  windowed as (
    select
      ad.d as date,
      count(a.id) as article_count_7d,
      count(a.id) filter (where a.is_ai_related) as ai_article_count_7d,
      avg(
        case a.llm_stance
          when 'alarmed'           then -1.0
          when 'critical'          then -0.5
          when 'neutral-explainer' then  0.0
          when 'policy-debate'     then  0.0
          when 'personal-story'    then  0.0
          when 'enthusiastic'      then  1.0
          else null
        end * a.llm_intensity
      ) as mean_temp
    from article_dates ad
    left join public.media_articles a
      on a.published_at::date between (ad.d - interval '6 days')::date and ad.d
      and a.published_at >= timestamptz '2024-01-01'
      and a.deleted_at is null
      and a.is_ai_related = true
      and a.tier2_completed_at is not null
    group by ad.d
  ),
  cat_balance as (
    select
      published_on as date,
      count(*) filter (where temperature > 0) as above,
      count(*) filter (where temperature < 0) as below
    from public.media_snapshot_category_daily
    group by published_on
  )
  select
    w.date,
    greatest(0, least(100, round(50 + 50 * coalesce(w.mean_temp, 0))::int)),
    w.article_count_7d,
    w.ai_article_count_7d,
    coalesce(c.above, 0),
    coalesce(c.below, 0)
  from windowed w
  left join cat_balance c on c.date = w.date;
end;
$$;

create or replace function public.refresh_media_snapshot_tier2_coverage_daily()
returns void language plpgsql security definer set search_path = public as $$
begin
  truncate table public.media_snapshot_tier2_coverage_daily;
  insert into public.media_snapshot_tier2_coverage_daily (date, ai_total, tier2_done)
  select
    published_at::date as date,
    count(*) filter (where is_ai_related)::int as ai_total,
    count(*) filter (
      where is_ai_related
        and llm_categories is not null
        and jsonb_array_length(
          coalesce(llm_categories->'categories', '[]'::jsonb)
        ) > 0
    )::int as tier2_done
  from public.media_articles
  where published_at is not null
    and published_at >= timestamptz '2024-01-01'
    and deleted_at is null
  group by published_at::date
  having count(*) filter (where is_ai_related) > 0;
end;
$$;
