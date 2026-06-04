-- 0074_retire_vibe_keyword.sql
-- Permanently retire the 'vibe' keyword.
--
-- WHY: "vibe" (seeded in 0030_brreg.sql:680 for vibe-coding / vibe-coder)
-- false-matches company NAMES like "VIBE MAT AS" (a food company), pulling
-- non-AI companies into the /oppstart dataset — and job postings in
-- /arbeidsmarked too, since 'vibe' is domain='jobs', shared by the NAV and
-- BRREG taggers.
--
-- A UI removal cannot retire it on its own: the keyword seeds in 0006/0030
-- re-run on every deploy with `insert ... on conflict (term_norm, language)
-- do nothing`, and status defaults to 'canonical' (0015). So a hard-deleted
-- row is re-inserted as a fresh canonical keyword on the next deploy
-- ("resurrection"). This migration is numbered ABOVE the seeds, so it runs
-- after them on every deploy and re-asserts status='rejected' — the
-- retirement therefore survives deploys regardless of seed re-insertion.
-- Same pattern as 0022_retire_redundant_keywords.sql.
--
-- Setting status (not DELETE) preserves the row, so historical
-- matched_keywords arrays still resolve for audit. The keyword matcher loads
-- status in (canonical,trial), so a 'rejected' term stops tagging at the next
-- ingest. NOTE: 'vibe' is now migration-pinned to rejected — re-activating it
-- via /admin/keywords will not survive the next deploy. To un-retire it later,
-- add a higher-numbered migration (never rewrite this one).
--
-- This migration retires the KEYWORD only. Existing company/posting AI flags
-- (brreg_companies.is_ai_relevant, nav_postings.is_ai) are recomputed by the
-- next retag — run "Re-tag alle pilarer" on /admin/keywords (or wait for the
-- Sunday retag cron) to drop VIBE MAT AS out of the published datasets.
--
-- Idempotent: the status guard makes re-runs a no-op once applied.

update public.keywords
   set status = 'rejected'
 where term_norm = 'vibe'
   and status <> 'rejected';
