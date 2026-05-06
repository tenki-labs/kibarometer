-- 0041_keyword_candidates_jsonb_refactor.sql
--
-- Replaces two scaling-bottleneck columns on keyword_candidates:
--   - `source text` (enum) → `sources jsonb` (text array of pipelines)
--   - `sample_posting_ids uuid[]` → `samples jsonb` (rich receipts incl.
--      titles + links + excerpt text per sample, source-tagged)
--
-- Why: the source enum already had 8 values after 0040 and each new
-- pipeline doubles them combinatorially. The receipts column was NAV-only
-- by construction, leaving media-only + brreg-only candidates with no
-- visible evidence on /admin/keywords/candidates. Both problems disappear
-- with jsonb shapes the RPC can populate directly across all three
-- pipelines.
--
-- This migration:
--   1. Adds sources + samples columns.
--   2. Backfills sources from source (case map).
--   3. Backfills samples from sample_posting_ids by joining nav_postings.
--   4. Drops the legacy source + sample_posting_ids columns.
--   5. Rewrites refresh_keyword_candidates() to populate sources + samples
--      directly, joining nav_postings + media_articles + brreg_companies
--      so receipts work uniformly for every pipeline.
--
-- Idempotent. Safe to re-run.

-- ── Step 1: add new columns ─────────────────────────────────────────────────

alter table public.keyword_candidates
  add column if not exists sources jsonb not null default '[]'::jsonb;
alter table public.keyword_candidates
  add column if not exists samples jsonb not null default '[]'::jsonb;

-- ── Step 2: backfill sources from source ────────────────────────────────────
-- Only runs if `source` column still exists (so re-runs after column-drop
-- skip cleanly). We check via information_schema rather than a try/catch
-- because do-blocks let us guard this cleanly.

do $backfill_sources$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'keyword_candidates'
      and column_name = 'source'
  ) then
    execute $$
      update public.keyword_candidates
      set sources = case source
        when 'jobs'         then '["jobs"]'::jsonb
        when 'media'        then '["media"]'::jsonb
        when 'brreg'        then '["brreg"]'::jsonb
        when 'both'         then '["jobs","media"]'::jsonb
        when 'jobs+media'   then '["jobs","media"]'::jsonb
        when 'jobs+brreg'   then '["jobs","brreg"]'::jsonb
        when 'media+brreg'  then '["media","brreg"]'::jsonb
        when 'all'          then '["jobs","media","brreg"]'::jsonb
        else '["jobs"]'::jsonb
      end
      where jsonb_array_length(sources) = 0
    $$;
  end if;
end $backfill_sources$;

-- ── Step 3: backfill samples from sample_posting_ids ────────────────────────

do $backfill_samples$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'keyword_candidates'
      and column_name = 'sample_posting_ids'
  ) then
    execute $$
      update public.keyword_candidates kc
      set samples = coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'source', 'jobs',
            'id', np.id::text,
            'title', np.title,
            'link', np.source_url,
            'text', np.description
          )
          order by np.posted_at desc nulls last
        )
        from public.nav_postings np
        where np.id::text = any(
          select x::text from unnest(kc.sample_posting_ids) as x
        )
      ), '[]'::jsonb)
      where jsonb_array_length(samples) = 0
        and kc.sample_posting_ids is not null
        and array_length(kc.sample_posting_ids, 1) > 0
    $$;
  end if;
end $backfill_samples$;

-- ── Step 4: drop legacy columns + their constraints ─────────────────────────

alter table public.keyword_candidates
  drop constraint if exists keyword_candidates_source_check;
alter table public.keyword_candidates
  drop column if exists source;
alter table public.keyword_candidates
  drop column if exists sample_posting_ids;

-- ── Step 5: rewrite refresh_keyword_candidates() ────────────────────────────
-- Aggregates phrases from all three source tables, tagging each phrase
-- with the union of pipelines that surfaced it (sources jsonb array) and
-- attaching up to 5 source-tagged receipts (samples jsonb array).
--
-- Receipt text per pipeline:
--   - jobs:  nav_postings.description (full body — page truncates).
--   - media: media_articles.headline (no body persisted by design).
--   - brreg: brreg_companies.aktivitet (NACE description).
--
-- Receipt link per pipeline:
--   - jobs:  nav_postings.source_url
--   - media: media_articles.url
--   - brreg: null (no canonical public URL — page can fall back to orgnr).

create or replace function public.refresh_keyword_candidates() returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  drop table if exists _kc_agg;
  create temp table _kc_agg on commit drop as
  with nav_phrase_rows as (
    select distinct
      lower(trim(p->>'text')) as term_norm,
      np.id::text as sample_id,
      np.title as sample_title,
      np.source_url as sample_link,
      np.description as sample_text,
      np.posted_at as seen_at,
      'jobs'::text as src
    from public.nav_postings np
    cross join lateral jsonb_array_elements(
      coalesce(np.llm_ai_phrases->'phrases', '[]'::jsonb)
    ) as p
    where np.posted_at >= now() - interval '90 days'
      and np.tier1_completed_at is not null
      and np.llm_ai_phrases is not null
  ),
  media_phrase_rows as (
    select distinct
      lower(trim(p->>'text')) as term_norm,
      ma.id::text as sample_id,
      ma.headline as sample_title,
      ma.url as sample_link,
      ma.headline as sample_text,
      coalesce(ma.published_at, ma.fetched_at) as seen_at,
      'media'::text as src
    from public.media_articles ma
    cross join lateral jsonb_array_elements(
      coalesce(ma.llm_ai_phrases->'phrases', '[]'::jsonb)
    ) as p
    where coalesce(ma.published_at, ma.fetched_at) >= now() - interval '90 days'
      and ma.tier1_completed_at is not null
      and ma.llm_ai_phrases is not null
  ),
  brreg_phrase_rows as (
    select distinct
      lower(trim(p->>'text')) as term_norm,
      bc.orgnr::text as sample_id,
      bc.navn as sample_title,
      null::text as sample_link,
      bc.aktivitet as sample_text,
      coalesce(bc.registrert_dato::timestamptz, bc.ingested_at) as seen_at,
      'brreg'::text as src
    from public.brreg_companies bc
    cross join lateral jsonb_array_elements(
      coalesce(bc.llm_ai_phrases->'phrases', '[]'::jsonb)
    ) as p
    where coalesce(bc.registrert_dato::timestamptz, bc.ingested_at)
            >= now() - interval '90 days'
      and bc.tier1_completed_at is not null
      and bc.llm_ai_phrases is not null
  ),
  all_phrase_rows as (
    select * from nav_phrase_rows
    union all
    select * from media_phrase_rows
    union all
    select * from brreg_phrase_rows
  ),
  -- Aggregate counts per phrase first, then enrich with samples + sources
  -- via joins. Grouping on term_norm only (no jsonb in GROUP BY) keeps
  -- the planner happy on a hot RPC.
  counts as (
    select
      term_norm,
      count(*)::int as evidence_count,
      min(seen_at) as first_seen_at,
      max(seen_at) as last_seen_at
    from all_phrase_rows
    where term_norm is not null
      and char_length(term_norm) between 3 and 80
    group by term_norm
    having count(*) >= 3
  ),
  -- Top-5 receipts per term across all three pipelines, ordered by
  -- recency. The inner row_number() picks which 5 to keep; the outer
  -- jsonb_agg builds the array.
  ranked as (
    select
      term_norm, sample_id, sample_title, sample_link, sample_text,
      seen_at, src,
      row_number() over (partition by term_norm order by seen_at desc) as rn
    from all_phrase_rows
  ),
  top_samples as (
    select
      term_norm,
      jsonb_agg(
        jsonb_build_object(
          'source', src,
          'id', sample_id,
          'title', sample_title,
          'link', sample_link,
          'text', sample_text
        )
        order by seen_at desc
      ) as samples
    from ranked
    where rn <= 5
    group by term_norm
  ),
  -- Distinct set of pipelines that surfaced each term.
  per_term_sources as (
    select
      term_norm,
      jsonb_agg(distinct to_jsonb(src) order by to_jsonb(src)) as sources
    from all_phrase_rows
    group by term_norm
  )
  select
    c.term_norm,
    c.evidence_count,
    c.first_seen_at,
    c.last_seen_at,
    coalesce(s.samples, '[]'::jsonb) as samples,
    coalesce(src.sources, '[]'::jsonb) as sources
  from counts c
  left join top_samples s on s.term_norm = c.term_norm
  left join per_term_sources src on src.term_norm = c.term_norm
  where c.term_norm not in (
    select term_norm from public.keywords
    where status in ('canonical', 'trial')
  )
    and c.term_norm not in (
      select term_norm from public.keyword_candidates
      where status in ('trial', 'canonical', 'rejected', 'merged')
    );

  -- Upsert. Pending rows get refreshed; adjudicated rows are guarded.
  insert into public.keyword_candidates (
    term_norm, evidence_count, first_seen_at, last_seen_at, samples, sources
  )
  select
    term_norm, evidence_count, first_seen_at, last_seen_at, samples, sources
  from _kc_agg
  on conflict (term_norm) do update set
    evidence_count = excluded.evidence_count,
    last_seen_at = excluded.last_seen_at,
    samples = excluded.samples,
    sources = excluded.sources
  where public.keyword_candidates.status = 'pending';

  -- Drop pending rows whose phrase no longer meets the threshold from
  -- any pipeline.
  delete from public.keyword_candidates kc
  where kc.status = 'pending'
    and not exists (
      select 1 from _kc_agg a where a.term_norm = kc.term_norm
    );

  drop table if exists _kc_agg;
end
$$;

comment on column public.keyword_candidates.sources is
  'jsonb text array of pipelines that surfaced this phrase (subset of jobs/media/brreg). Computed by refresh_keyword_candidates(). Replaces the legacy source enum from 0034/0040.';

comment on column public.keyword_candidates.samples is
  'jsonb array of source-tagged receipts: [{source, id, title, link, text}, ...]. Up to 5 per candidate. Computed by refresh_keyword_candidates(). Replaces the legacy NAV-only sample_posting_ids uuid[] from 0016.';
