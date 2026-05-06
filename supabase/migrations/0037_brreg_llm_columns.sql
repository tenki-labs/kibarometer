-- 0037_brreg_llm_columns.sql
-- Adds the LLM Tier 1 / Tier 2 columns to brreg_companies so the brreg
-- pipeline can run discovery (verbatim AI-phrase extraction → fed to
-- /admin/keywords/candidates via refresh_keyword_candidates) and fine
-- categorization (assignment to brreg_categories slugs).
--
-- Mirrors the shape on nav_postings + media_articles so the candidates
-- aggregation RPC (0040) can scan all three tables uniformly.
--
-- Idempotent.

alter table public.brreg_companies
  add column if not exists llm_ai_phrases jsonb;
alter table public.brreg_companies
  add column if not exists tier1_completed_at timestamptz;
alter table public.brreg_companies
  add column if not exists tier2_completed_at timestamptz;
alter table public.brreg_companies
  add column if not exists tier2_categories jsonb;
alter table public.brreg_companies
  add column if not exists tier2_rationale text;
alter table public.brreg_companies
  add column if not exists llm_retry_count int not null default 0;
-- Mirrors nav_postings.retagged_at + media_articles.retagged_at — set by
-- the manual keyword-mapping reprocess to mark rows touched in a batch.
alter table public.brreg_companies
  add column if not exists retagged_at timestamptz;

-- Partial indexes for the two queue scans the orchestrators run on every
-- tick. The is_ai_relevant filter is the only thing keeping cost bounded
-- on a table that holds every Norwegian company.
create index if not exists brreg_tier1_queue_idx
  on public.brreg_companies (registrert_dato desc)
  where is_ai_relevant and tier1_completed_at is null;

create index if not exists brreg_tier2_queue_idx
  on public.brreg_companies (registrert_dato desc)
  where is_ai_relevant
    and tier1_completed_at is not null
    and tier2_completed_at is null;
