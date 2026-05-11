-- 0061_media_sitemap_method.sql
--
-- Re-adds 'sitemap' to the allowed backfill_method values on
-- media_sources. 0057 tightened the CHECK to scrapegraph-only on the
-- assumption that ddgs-based discovery would cover everything — but
-- DuckDuckGo's index doesn't reliably reach back to 2020, and we need
-- sitemap walking with <lastmod> filtering to populate the historical
-- archive. See lib/admin/legacy/media-sitemap.js (restored from PR #123
-- + extended with date filtering) and the new "Backfill til 2020"
-- button.
--
-- 'scrapegraph' remains the default for new rows. Operators flip
-- individual sources to 'sitemap' from /admin/media/sources/<id>/edit
-- once a `sitemap_url` is set. The two `sitemap_url` and
-- `sitemap_index` columns were never dropped (only hidden from the
-- form), so no column add is needed.
--
-- Idempotent. Re-running on a DB that already allows both values is a
-- no-op.

alter table public.media_sources
  drop constraint if exists media_sources_backfill_method_check;
alter table public.media_sources
  add constraint media_sources_backfill_method_check
  check (backfill_method in ('scrapegraph', 'sitemap'));
