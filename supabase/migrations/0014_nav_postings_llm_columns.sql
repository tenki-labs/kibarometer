-- 0014_nav_postings_llm_columns.sql
-- LLM-driven analytics columns on nav_postings.
--
-- Two-tier pipeline backed by mlx.tenki.no (Gemma 3 4B-IT, Cloudflare-tunneled
-- OpenAI-compatible endpoint; see docs/api_docs.md):
--
--   Tier 1 — Discovery. Verbatim AI-skill-phrase extraction from EVERY new
--     posting regardless of occupation. Output validated by includes()-check
--     before persistence so hallucinated phrases never land in the DB.
--   Tier 2 — Classification. Taxonomy-based bucket assignment on AI-positive
--     postings (where is_ai = true).
--
-- The keyword tagger continues to populate is_ai / matched_keywords as the
-- offline-resilient backstop. New keywords are PROMOTED from Tier 1 phrases
-- via the candidate review queue (PR 6) — promotion does not call the LLM.
--
-- Idempotent.

alter table public.nav_postings
  add column if not exists tier1_completed_at timestamptz,
  add column if not exists llm_ai_phrases jsonb,
  add column if not exists tier2_completed_at timestamptz,
  add column if not exists llm_categories jsonb,
  add column if not exists llm_status text,
  add column if not exists llm_taxonomy_version int,
  add column if not exists llm_prompt_id uuid,
  add column if not exists llm_retry_count int not null default 0;

-- Check constraint added separately so a re-run is a no-op.
do $cstr$
begin
  alter table public.nav_postings
    add constraint nav_postings_llm_status_check check (
      llm_status is null or llm_status in (
        'tier1_ok','tier1_parse_failed','tier1_failed','tier1_auth_failed',
        'tier2_ok','tier2_parse_failed','tier2_failed','tier2_auth_failed',
        'skipped'
      )
    );
exception when duplicate_object then null;
end $cstr$;

-- Tier 1 queue: every posting that hasn't been discovered yet and hasn't
-- exhausted its retries. Posted_at desc so the freshest postings get
-- analysed first; if the queue ever overflows, the recovery mode (PR 2)
-- can sample the rest.
create index if not exists nav_postings_tier1_queue_idx
  on public.nav_postings (posted_at desc)
  where tier1_completed_at is null and llm_retry_count < 3;

-- Tier 2 queue: AI-positive postings without classification.
create index if not exists nav_postings_tier2_queue_idx
  on public.nav_postings (posted_at desc)
  where is_ai = true and tier2_completed_at is null and llm_retry_count < 3;
