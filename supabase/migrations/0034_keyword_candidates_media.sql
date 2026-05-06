-- 0034_keyword_candidates_media.sql
--
-- Generalize the keyword discovery flow so candidates surface from both
-- pipelines (NAV postings + media articles), not just NAV. The
-- `keywords` table itself was already domain-aware (the `domain` column
-- landed in 0029_media.sql), but `refresh_keyword_candidates()` only
-- scanned `nav_postings.llm_ai_phrases` — so any AI-related phrases
-- the media tier1 LLM extracted never showed up for review.
--
-- This migration:
--   1. Adds a `source` column to keyword_candidates ('jobs' | 'media'
--      | 'both') so the review UI can show provenance. Existing rows
--      backfill to 'jobs' since that was the only source until now.
--   2. Rewrites refresh_keyword_candidates() to aggregate phrases from
--      both nav_postings AND media_articles in a single pass, computing
--      `source` as 'jobs', 'media', or 'both' depending on which
--      pipelines surfaced each phrase. Same 90-day window, same
--      evidence_count >= 3 threshold, same skip-already-adjudicated
--      logic.
--   3. Updates the upsert path to refresh `source` on existing pending
--      rows so a phrase that previously only showed up in NAV but now
--      also appears in media coverage gets bumped to 'both'.
--
-- The function uses sample_posting_ids from nav_postings only (not
-- mixed with media_articles ids) to keep the existing review UI
-- working unchanged. A follow-up could add sample_article_ids if the
-- review flow needs to surface media examples.
--
-- Idempotent. Safe to re-run.

alter table public.keyword_candidates
  add column if not exists source text not null default 'jobs'
    check (source in ('jobs', 'media', 'both'));

-- Backfill: any rows that existed before this migration ran were
-- sourced from NAV. The default takes care of new inserts.
update public.keyword_candidates set source = 'jobs' where source is null;

create or replace function public.refresh_keyword_candidates() returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Stage current aggregation in a temp table so the upsert and the
  -- delete-stale step both consult the same snapshot. on commit drop
  -- ensures cleanup when the function is invoked via PostgREST RPC.
  drop table if exists _kc_agg;
  create temp table _kc_agg on commit drop as
  with nav_phrase_rows as (
    -- Distinct per posting so the same phrase appearing twice in one
    -- posting only counts once toward evidence_count.
    select distinct
      lower(trim(p->>'text')) as term_norm,
      np.id as posting_id,
      np.posted_at as seen_at
    from public.nav_postings np
    cross join lateral jsonb_array_elements(
      coalesce(np.llm_ai_phrases->'phrases', '[]'::jsonb)
    ) as p
    where np.posted_at >= now() - interval '90 days'
      and np.tier1_completed_at is not null
      and np.llm_ai_phrases is not null
  ),
  media_phrase_rows as (
    -- Same shape, but on media articles. published_at can be null for
    -- recently fetched but not-yet-dated articles — fall back to
    -- fetched_at so they still count toward the 90-day window.
    select distinct
      lower(trim(p->>'text')) as term_norm,
      coalesce(ma.published_at, ma.fetched_at) as seen_at
    from public.media_articles ma
    cross join lateral jsonb_array_elements(
      coalesce(ma.llm_ai_phrases->'phrases', '[]'::jsonb)
    ) as p
    where coalesce(ma.published_at, ma.fetched_at) >= now() - interval '90 days'
      and ma.tier1_completed_at is not null
      and ma.llm_ai_phrases is not null
  ),
  -- Per-term source flags. Computed before evidence aggregation so a
  -- term appearing once in NAV and once in media gets source='both'
  -- even if neither pipeline alone hit the evidence_count threshold —
  -- the joint count is what matters for promotion.
  nav_terms as (
    select distinct term_norm from nav_phrase_rows where term_norm is not null
  ),
  media_terms as (
    select distinct term_norm from media_phrase_rows where term_norm is not null
  )
  select
    p.term_norm,
    count(*)::int as evidence_count,
    min(p.seen_at) as first_seen_at,
    max(p.seen_at) as last_seen_at,
    -- Sample IDs from NAV only — keeps the review UI's existing
    -- sample-posting links working without a schema change. Empty
    -- array when a candidate is media-only.
    (
      select coalesce(
        (
          select array_agg(posting_id order by seen_at desc)
          from (
            select posting_id, seen_at
            from nav_phrase_rows np2
            where np2.term_norm = p.term_norm
            order by seen_at desc
            limit 5
          ) as t
        ),
        '{}'::text[]
      )
    ) as sample_posting_ids,
    case
      when p.term_norm in (select term_norm from nav_terms)
       and p.term_norm in (select term_norm from media_terms) then 'both'
      when p.term_norm in (select term_norm from media_terms) then 'media'
      else 'jobs'
    end as source
  from (
    select term_norm, seen_at from nav_phrase_rows
    union all
    select term_norm, seen_at from media_phrase_rows
  ) p
  where p.term_norm is not null
    and char_length(p.term_norm) between 3 and 80
    -- Skip phrases already represented in the active keyword catalogue;
    -- they don't need promotion. Trial keywords are skipped too — they're
    -- already in flight.
    and p.term_norm not in (
      select term_norm from public.keywords
      where status in ('canonical', 'trial')
    )
    -- Skip phrases the operator has already adjudicated.
    and p.term_norm not in (
      select term_norm from public.keyword_candidates
      where status in ('trial', 'canonical', 'rejected', 'merged')
    )
  group by p.term_norm
  having count(*) >= 3;

  -- Upsert. The where-clause on do-update guards adjudicated rows that
  -- might have raced past the agg-side filter.
  insert into public.keyword_candidates (
    term_norm, evidence_count, first_seen_at, last_seen_at,
    sample_posting_ids, source
  )
  select
    term_norm, evidence_count, first_seen_at, last_seen_at,
    sample_posting_ids, source
  from _kc_agg
  on conflict (term_norm) do update set
    evidence_count = excluded.evidence_count,
    last_seen_at = excluded.last_seen_at,
    sample_posting_ids = excluded.sample_posting_ids,
    source = excluded.source
  where public.keyword_candidates.status = 'pending';

  -- Drop pending rows whose phrase no longer meets the threshold from
  -- either pipeline.
  delete from public.keyword_candidates kc
  where kc.status = 'pending'
    and not exists (
      select 1 from _kc_agg a where a.term_norm = kc.term_norm
    );

  drop table if exists _kc_agg;
end
$$;

comment on column public.keyword_candidates.source is
  'Which pipeline(s) surfaced this phrase: jobs (nav_postings only), media (media_articles only), or both. Computed by refresh_keyword_candidates(); reflects the most recent refresh.';
