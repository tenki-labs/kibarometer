-- 0019_promote_keyword_candidate.sql
-- Backfill function used by /admin/keywords/candidates promotion actions
-- (PR 6). Promoting a Tier 1 phrase into the keyword catalogue is a pure
-- SQL update — no LLM is called — because the phrase already lives in
-- nav_postings.llm_ai_phrases (verbatim-validated by the Tier 1
-- orchestrator).
--
-- Inputs:
--   p_match_term   — the candidate phrase to look for inside llm_ai_phrases.
--                    Case-insensitive: same posting can have "Machine Learning"
--                    and "machine learning" stored separately; both get
--                    backfilled by a single promotion of either casing.
--   p_keyword_term — the term to append to matched_keywords. For "approve"
--                    this is the same as p_match_term; for "merge into X"
--                    this is X (so all evidence rolls under the canonical
--                    keyword).
--
-- Returns the number of nav_postings rows updated. Idempotent — re-running
-- with the same args is a no-op (the not-already-contains guard skips rows
-- that already have the keyword).
--
-- Called by the candidates server actions via PostgREST RPC at
-- /rpc/apply_keyword_to_postings. SECURITY DEFINER + service-role-only RLS
-- (admin write policy on nav_postings already covers this in 0007).
--
-- Idempotent.

create or replace function public.apply_keyword_to_postings(
  p_match_term text,
  p_keyword_term text
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  affected int;
begin
  if p_match_term is null or p_keyword_term is null then
    return 0;
  end if;

  with hits as (
    select np.id, np.matched_keywords
    from public.nav_postings np
    where np.llm_ai_phrases is not null
      and exists (
        select 1
        from jsonb_array_elements(
          coalesce(np.llm_ai_phrases->'phrases', '[]'::jsonb)
        ) as p
        where lower(p->>'text') = lower(p_match_term)
      )
      and not (np.matched_keywords @> array[p_keyword_term])
  ),
  upd as (
    update public.nav_postings np
       set is_ai = true,
           matched_keywords = np.matched_keywords || array[p_keyword_term]
      from hits
     where np.id = hits.id
    returning np.id
  )
  select count(*)::int into affected from upd;

  return coalesce(affected, 0);
end
$$;
