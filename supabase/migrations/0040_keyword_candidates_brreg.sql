-- 0040_keyword_candidates_brreg.sql
--
-- Extends the keyword discovery loop to a third pipeline: brreg
-- companies. Builds on 0034 (which generalized from NAV-only to
-- NAV+media); this migration adds brreg_companies as a third source.
--
-- Three things this migration does:
--   1. Widens keyword_candidates.source check to allow brreg-inclusive
--      values: 'jobs', 'media', 'brreg', 'jobs+media', 'jobs+brreg',
--      'media+brreg', 'all'. Existing rows keep their values
--      ('jobs' / 'media' / 'both'). The legacy 'both' value is retained
--      for backwards compatibility — the RPC writes 'jobs+media'
--      going forward, but historic 'both' rows still satisfy the
--      check.
--   2. Widens keywords.domain check to allow 'brreg' so promoted
--      brreg-discovered candidates can be tagged with their source
--      domain (per D4 of the PRD).
--   3. Rewrites refresh_keyword_candidates() to scan brreg_companies
--      as a third source. Source computation generalizes from the
--      pairwise NAV/media branches in 0034 to a three-way set check.
--
-- Sample receipts: still NAV-only. The candidates page joins
-- sample_posting_ids → nav_postings only; brreg-only and media-only
-- candidates therefore render with empty sample arrays. This is the
-- same caveat media has had since 0034 and is tracked as a known
-- candidates-page polish follow-up. Not blocking the brreg LLM rollout.
--
-- Idempotent. Safe to re-run.

do $cstr$
begin
  alter table public.keyword_candidates
    drop constraint if exists keyword_candidates_source_check;
  alter table public.keyword_candidates
    add constraint keyword_candidates_source_check
      check (source in (
        'jobs',
        'media',
        'brreg',
        -- Legacy two-pipeline value from 0034. Kept so existing rows
        -- pass the new check without an UPDATE.
        'both',
        'jobs+media',
        'jobs+brreg',
        'media+brreg',
        'all'
      ));
end $cstr$;

do $domain$
begin
  alter table public.keywords
    drop constraint if exists keywords_domain_check;
  alter table public.keywords
    add constraint keywords_domain_check
      check (domain in ('jobs', 'media', 'brreg', 'any'));
end $domain$;

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
    -- published_at can be null for recently fetched but not-yet-dated
    -- articles — fall back to fetched_at so they still count toward
    -- the 90-day window.
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
  brreg_phrase_rows as (
    -- registrert_dato is the founding date — closest analogue to
    -- posted_at / published_at. Fall back to ingested_at if missing
    -- (some historic rows lack a registrert_dato).
    select distinct
      lower(trim(p->>'text')) as term_norm,
      coalesce(bc.registrert_dato::timestamptz, bc.ingested_at) as seen_at
    from public.brreg_companies bc
    cross join lateral jsonb_array_elements(
      coalesce(bc.llm_ai_phrases->'phrases', '[]'::jsonb)
    ) as p
    where coalesce(bc.registrert_dato::timestamptz, bc.ingested_at)
            >= now() - interval '90 days'
      and bc.tier1_completed_at is not null
      and bc.llm_ai_phrases is not null
  ),
  -- Per-term presence flags. Computed before evidence aggregation so a
  -- term appearing in multiple pipelines is correctly tagged even when
  -- no single pipeline alone hits the evidence threshold.
  nav_terms as (
    select distinct term_norm from nav_phrase_rows where term_norm is not null
  ),
  media_terms as (
    select distinct term_norm from media_phrase_rows where term_norm is not null
  ),
  brreg_terms as (
    select distinct term_norm from brreg_phrase_rows where term_norm is not null
  )
  select
    p.term_norm,
    count(*)::int as evidence_count,
    min(p.seen_at) as first_seen_at,
    max(p.seen_at) as last_seen_at,
    -- Sample IDs from NAV only — keeps the review UI's existing
    -- sample-posting links working without a schema change. Empty
    -- array when a candidate is media-only or brreg-only. Tracked
    -- as a candidates-page polish follow-up.
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
    -- Three-way set check. The order of the case-arms matters: 'all'
    -- must be checked first, then the pairwise combinations, then
    -- the singletons.
    case
      when p.term_norm in (select term_norm from nav_terms)
       and p.term_norm in (select term_norm from media_terms)
       and p.term_norm in (select term_norm from brreg_terms) then 'all'
      when p.term_norm in (select term_norm from nav_terms)
       and p.term_norm in (select term_norm from media_terms) then 'jobs+media'
      when p.term_norm in (select term_norm from nav_terms)
       and p.term_norm in (select term_norm from brreg_terms) then 'jobs+brreg'
      when p.term_norm in (select term_norm from media_terms)
       and p.term_norm in (select term_norm from brreg_terms) then 'media+brreg'
      when p.term_norm in (select term_norm from brreg_terms) then 'brreg'
      when p.term_norm in (select term_norm from media_terms) then 'media'
      else 'jobs'
    end as source
  from (
    select term_norm, seen_at from nav_phrase_rows
    union all
    select term_norm, seen_at from media_phrase_rows
    union all
    select term_norm, seen_at from brreg_phrase_rows
  ) p
  where p.term_norm is not null
    and char_length(p.term_norm) between 3 and 80
    -- Skip phrases already represented in the active keyword catalogue;
    -- they don't need promotion. Trial keywords are skipped too — they
    -- are already in flight.
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
  -- any pipeline.
  delete from public.keyword_candidates kc
  where kc.status = 'pending'
    and not exists (
      select 1 from _kc_agg a where a.term_norm = kc.term_norm
    );

  drop table if exists _kc_agg;
end
$$;

comment on column public.keyword_candidates.source is
  'Which pipeline(s) surfaced this phrase: jobs, media, brreg, jobs+media, jobs+brreg, media+brreg, all. Legacy ''both'' value is retained for rows from before 0040 (equivalent to ''jobs+media''). Computed by refresh_keyword_candidates(); reflects the most recent refresh.';
