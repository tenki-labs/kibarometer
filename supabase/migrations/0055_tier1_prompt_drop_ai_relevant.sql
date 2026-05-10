-- 0055_tier1_prompt_drop_ai_relevant.sql
--
-- Aligns the Tier 1 LLM prompts with the keyword-driven AI-relevance
-- design. Previously the prompts asked for `ai_relevant: <bool>` in the
-- JSON response, but that field has never been load-bearing — `is_ai*`
-- columns are written by the keyword matcher at ingest, never by an
-- LLM. Tier 1 only extracts verbatim AI-phrases for keyword-catalog
-- growth.
--
-- Strips the `"ai_relevant": <bool>,` key from the active prompt body
-- in place, preserving every other paragraph (operator edits via
-- /admin/{job-market,media,startups}/prompts survive). Targets schema
-- lines AND few-shot example bodies in one regex pass — the seeded
-- prompts in 0018/0031/0039 always emit the key first with a trailing
-- comma:
--   {"ai_relevant": <bool>, "phrases": [...]}
--   {"ai_relevant": true,   "phrases": [...]}
--   {"ai_relevant": false,  "phrases": []}
--
-- The orchestrators (lib/admin/llm-discover.ts, llm-media-tier1.ts,
-- llm-brreg-tier1.ts) and the shared parser (llm-media-parse.ts)
-- ignore the legacy field if a mid-rollout LLM still emits it, so this
-- migration can land independently of the code change.
--
-- Idempotent. The `body like '%"ai_relevant"%'` guard makes re-runs
-- after the rewrite a no-op.

update public.llm_prompts
   set body = regexp_replace(
       body,
       '"ai_relevant"\s*:\s*(true|false|<bool>)\s*,?\s*',
       '',
       'g'
     )
 where role in ('tier1', 'media_tier1', 'brreg_tier1')
   and active = true
   and body like '%"ai_relevant"%';
