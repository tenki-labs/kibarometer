-- 0015_keyword_status.sql
-- Replace keywords.is_active boolean with a three-state status enum:
--   canonical — promoted, matched in tagging, counted in public stats.
--   trial     — provisionally promoted via the candidate review queue (PR 6).
--               Matches in tagging so we can observe behaviour, but is excluded
--               from public is_ai counts at snapshot time.
--   rejected  — soft-deleted. Preserved on the row so any nav_postings.matched_keywords
--               array still resolves; never matches.
--
-- Existing rows: is_active=true → canonical, is_active=false → rejected.
--
-- Touches the matcher query in lib/admin/legacy/nav-processor.js (now
-- status=in.(canonical,trial)) and every UI consumer of keywords.is_active.
--
-- Idempotent.

alter table public.keywords add column if not exists status text;

-- Backfill from is_active when it still exists; default to canonical otherwise.
do $migrate$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'keywords' and column_name = 'is_active'
  ) then
    update public.keywords
       set status = case when is_active then 'canonical' else 'rejected' end
     where status is null;
  else
    update public.keywords set status = 'canonical' where status is null;
  end if;
end $migrate$;

alter table public.keywords alter column status set default 'canonical';
alter table public.keywords alter column status set not null;

do $cstr$
begin
  alter table public.keywords
    add constraint keywords_status_check
      check (status in ('canonical','trial','rejected'));
exception when duplicate_object then null;
end $cstr$;

-- Drop dependents that referenced is_active. Recreated below using status.
drop policy if exists keywords_public_read on public.keywords;
drop index if exists keywords_active_category_idx;

alter table public.keywords drop column if exists is_active;

-- Recreate the partial index on the new column. Trial keywords don't go in —
-- the matcher reads via PostgREST and trial is rare; sequential scan is fine.
create index if not exists keywords_canonical_category_idx
  on public.keywords (category, term_norm) where status = 'canonical';

-- Public read of canonical keywords only. Trial keywords are operator-internal
-- until graduated; staff still see them via the keywords_staff_read policy
-- defined in 0006_keywords.sql.
create policy keywords_public_read on public.keywords
  for select using (status = 'canonical');
