-- 0016_keyword_candidates.sql
-- Candidate review queue for promoting Tier 1 LLM-extracted phrases into the
-- public keyword catalogue. Tier 1 (PR 2) persists verbatim-validated phrases
-- in nav_postings.llm_ai_phrases; this migration adds the aggregation layer
-- that surfaces phrases recurring across multiple postings, and the operator
-- review state machine on top of it.
--
-- Aggregation thresholds (per plan):
--   * 90-day rolling window (matches "recent demand")
--   * >= 3 distinct postings before a phrase becomes pending
--   * 5 sample posting IDs kept on each row for the receipts UI (PR 6)
--
-- Status state machine:
--   pending   — surfaced by aggregation, awaiting operator review
--   trial     — promoted to keywords.status='trial' (matches but doesn't count
--               toward public is_ai stats yet)
--   canonical — promoted to keywords.status='canonical' (matches and counts)
--   rejected  — operator declined; row is kept as audit log so the same phrase
--               doesn't keep re-surfacing
--   merged    — operator marked equivalent to an existing canonical keyword
--               (e.g. "Machine Learning" merged into "machine learning"). The
--               target term goes in merged_into_term.
--
-- The refresh function is called from refreshSnapshots() in
-- lib/admin/legacy/jobs.js (daily 04:00) and after every promote/reject/merge
-- action so the queue stays current.
--
-- Idempotent.

create table if not exists public.keyword_candidates (
  term_norm text primary key,
  evidence_count int not null,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  sample_posting_ids uuid[] not null default '{}',
  status text not null default 'pending'
    check (status in ('pending','trial','canonical','rejected','merged')),
  merged_into_term text,
  reviewed_at timestamptz,
  reviewed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists keyword_candidates_status_evidence_idx
  on public.keyword_candidates (status, evidence_count desc);

drop trigger if exists keyword_candidates_updated_at on public.keyword_candidates;
create trigger keyword_candidates_updated_at
  before update on public.keyword_candidates
  for each row execute function public.trigger_set_updated_at();

alter table public.keyword_candidates enable row level security;

-- Admin-only table; no public read. Trial/rejected state shouldn't leak.
drop policy if exists keyword_candidates_staff_read on public.keyword_candidates;
create policy keyword_candidates_staff_read on public.keyword_candidates
  for select using (public.is_staff());

drop policy if exists keyword_candidates_admin_write on public.keyword_candidates;
create policy keyword_candidates_admin_write on public.keyword_candidates
  for all using (public.is_admin_or_super())
  with check (public.is_admin_or_super());

-- Refresh function. Re-aggregates Tier 1 phrases over the last 90 days,
-- upserts pending candidates with current counts/samples, and removes
-- pending rows whose phrases no longer meet the >= 3 threshold (e.g. aged
-- out of the window). Promoted/rejected/merged rows are immune — they
-- represent operator decisions and are preserved as audit log.
--
-- Called from refreshSnapshots() in jobs.js + after every review action
-- (PR 6). Read-only outside service-role; PostgREST exposes it as
-- /rpc/refresh_keyword_candidates.
create or replace function public.refresh_keyword_candidates() returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Stage current aggregation in a temp table so the upsert and the
  -- delete-stale step both consult the same snapshot. on commit drop
  -- ensures cleanup when the function is invoked via PostgREST RPC
  -- (which wraps the call in a transaction).
  drop table if exists _kc_agg;
  create temp table _kc_agg on commit drop as
  with phrase_rows as (
    -- Distinct so the same phrase appearing twice in one posting only
    -- counts once toward evidence_count.
    select distinct
      lower(trim(p->>'text')) as term_norm,
      np.id as posting_id,
      np.posted_at
    from public.nav_postings np
    cross join lateral jsonb_array_elements(
      coalesce(np.llm_ai_phrases->'phrases', '[]'::jsonb)
    ) as p
    where np.posted_at >= now() - interval '90 days'
      and np.tier1_completed_at is not null
      and np.llm_ai_phrases is not null
  )
  select
    term_norm,
    count(*)::int as evidence_count,
    min(posted_at) as first_seen_at,
    max(posted_at) as last_seen_at,
    (array_agg(posting_id order by posted_at desc))[1:5] as sample_posting_ids
  from phrase_rows
  where term_norm is not null
    and char_length(term_norm) between 3 and 80
    -- Skip phrases already represented in the active keyword catalogue;
    -- they don't need promotion. Trial keywords are also skipped — they're
    -- already in flight as a decision.
    and term_norm not in (
      select term_norm from public.keywords
      where status in ('canonical', 'trial')
    )
    -- Skip phrases the operator has already adjudicated. Pending rows are
    -- the only ones the refresh updates; everything else is preserved.
    and term_norm not in (
      select term_norm from public.keyword_candidates
      where status in ('trial', 'canonical', 'rejected', 'merged')
    )
  group by term_norm
  having count(*) >= 3;

  -- Upsert: insert new candidates, refresh metadata on existing pending ones.
  -- The where-clause on do-update guards promoted/rejected/merged rows that
  -- somehow survived the agg-side filter (race between refresh + review).
  insert into public.keyword_candidates (
    term_norm, evidence_count, first_seen_at, last_seen_at, sample_posting_ids
  )
  select term_norm, evidence_count, first_seen_at, last_seen_at, sample_posting_ids
  from _kc_agg
  on conflict (term_norm) do update set
    evidence_count = excluded.evidence_count,
    last_seen_at = excluded.last_seen_at,
    sample_posting_ids = excluded.sample_posting_ids
  where public.keyword_candidates.status = 'pending';

  -- Drop pending rows whose phrase no longer meets the threshold (faded
  -- out of the 90-day window, or got promoted into keywords externally).
  -- Operator decisions in trial/canonical/rejected/merged are preserved.
  delete from public.keyword_candidates kc
  where kc.status = 'pending'
    and not exists (
      select 1 from _kc_agg a where a.term_norm = kc.term_norm
    );

  drop table if exists _kc_agg;
end
$$;
