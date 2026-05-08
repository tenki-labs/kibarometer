-- 0044_scrapegraph_backfill_method.sql
--
-- Adds 'scrapegraph' as a backfill_method on media_sources, makes it
-- the new default, and adds a typed `category` column so the public
-- /metode Kilder section can group outlets without parsing free-text
-- notes.
--
-- The 'scrapegraph' adapter (kiba-scraper sidecar) handles URL
-- discovery via DuckDuckGo + Playwright fetching + LLM-driven body
-- extraction against the local MLX cluster. It supersedes 'site_search'
-- for new outlets — existing rows on 'site_search' or 'sitemap' keep
-- working unchanged. Operator opts each existing source in via the
-- /admin/media/sources/<id>/edit form when ready.
--
-- Category column derives values from existing notes prefixes where
-- possible (the 0035 seed wrote "Mainstream — …", "Tech/IT — …", etc.).
-- Older rows from 0029 (Digi.no, Kode24) fall through to 'tech'.
--
-- Idempotent. Re-running on a DB that already has these columns is a
-- no-op.

-- 1. Add 'scrapegraph' to the backfill_method check constraint.
--    The constraint name in 0029_media.sql:113 is auto-named by Postgres
--    as media_sources_backfill_method_check.
alter table public.media_sources
  drop constraint if exists media_sources_backfill_method_check;
alter table public.media_sources
  add constraint media_sources_backfill_method_check
  check (backfill_method in ('scrapegraph','rss_only','sitemap','site_search'));
alter table public.media_sources
  alter column backfill_method set default 'scrapegraph';

-- 2. Typed category column for the /metode public source list.
alter table public.media_sources
  add column if not exists category text
  check (category in ('mainstream','tech','business','policy','other'));

-- Backfill from notes-prefix where the 0035 seed wrote a recognisable
-- category lead. Each statement only touches rows that are still null,
-- so partial-state re-runs converge.
update public.media_sources set category = 'mainstream'
  where category is null and notes ilike 'mainstream%';
update public.media_sources set category = 'tech'
  where category is null and (notes ilike 'tech/it%' or notes ilike 'tech%');
update public.media_sources set category = 'business'
  where category is null and notes ilike 'business%';
update public.media_sources set category = 'policy'
  where category is null and notes ilike 'policy%';
-- Pilot rows (Digi.no, Kode24) and any outlet whose notes don't start
-- with a category prefix → 'tech' if domain hints at tech press, else
-- 'other'. Operator can refine via the admin UI.
update public.media_sources set category = 'tech'
  where category is null
    and (
      domain in ('digi.no','kode24.no','tek.no','itavisen.no')
      or domain ilike '%tech%'
    );
update public.media_sources set category = 'other' where category is null;

comment on column public.media_sources.category is
  'Editorial grouping for the /metode Kilder section. Set via /admin/media/sources/<id>/edit.';
