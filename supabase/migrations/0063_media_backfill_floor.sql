-- 0063_media_backfill_floor.sql
--
-- Earliest publication date the media backfill walks back to. Used by
-- the "Backfill til 2020" button on /admin/media/sources, which passes
-- this date as `since` into runMediaBackfill → walkSitemap so that
-- <url> entries with <lastmod> older than the floor are skipped and
-- sub-sitemaps whose own <lastmod> is older are not even fetched.
--
-- 2020 was picked over 2018 because that's where the modern AI news
-- cycle effectively starts in Norwegian media — pre-2020 mentions of
-- AI are scattered, often translated wire stories or research-paper
-- citations, and the keyword filter struggles to separate signal from
-- noise. Operator can tighten or loosen via psql:
--   update app_settings
--      set media_backfill_floor_date = date '2018-01-01'
--    where id = 1;
--
-- Mirrors the brreg pattern from 0047_brreg_2018_floor.sql — single
-- column on the single-row app_settings table.
--
-- Idempotent. `add column if not exists` is a no-op on re-run; the
-- existing row receives the default value when the column is created.

alter table public.app_settings
  add column if not exists media_backfill_floor_date date
  not null default date '2020-01-01';

comment on column public.app_settings.media_backfill_floor_date is
  'Floor date for media backfill (Backfill til 2020 button). Passed as `since` into walkSitemap. Default 2020-01-01 — pre-2020 Norwegian AI news coverage is sparse and noisy.';
