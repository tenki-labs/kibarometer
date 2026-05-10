-- 0057_scrapegraph_only.sql
--
-- Retires the three legacy backfill_method values ('rss_only',
-- 'site_search', 'sitemap'). After this migration the only accepted
-- value on media_sources.backfill_method is 'scrapegraph'. Existing
-- rows on any legacy value are converted in place; the CHECK
-- constraint added by 0044 is tightened to a single allowed value.
--
-- Idempotent. Re-running on a DB that's already scrapegraph-only is a
-- no-op.

update public.media_sources
   set backfill_method = 'scrapegraph'
 where backfill_method <> 'scrapegraph';

alter table public.media_sources
  drop constraint if exists media_sources_backfill_method_check;
alter table public.media_sources
  add constraint media_sources_backfill_method_check
  check (backfill_method = 'scrapegraph');

-- Restate the default (already 'scrapegraph' since 0044) so a fresh
-- bootstrap from this point still defaults correctly even if 0044 is
-- ever squashed away.
alter table public.media_sources
  alter column backfill_method set default 'scrapegraph';
