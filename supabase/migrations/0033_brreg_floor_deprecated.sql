-- 0033_brreg_floor_deprecated.sql
--
-- Brreg backfill (renamed from bootstrap in PR 7 of the admin
-- restructure) now loads the full Brreg registry with no date filter.
-- The legacy app_settings.brreg_bootstrap_floor_date column drove a
-- "registreringsdatoEnhetsregisteret >= floor" filter inside
-- bootstrapBrreg() and defaulted to 2018-01-01.
--
-- This migration:
--   1. Drops the not-null + default so the column can hold null going forward
--   2. Nulls the existing app_settings row (the singleton id=1)
--   3. Adds a deprecated comment so future readers know the column is unused
--
-- The column is kept rather than dropped so historical migration audits
-- still resolve cleanly. lib/admin/legacy/brreg.js was updated alongside
-- this migration to treat null floor as "no filter, full registry".
--
-- Idempotent — re-running on a DB that already had the constraint
-- removed and the row nulled is a no-op.

alter table public.app_settings
  alter column brreg_bootstrap_floor_date drop not null;

alter table public.app_settings
  alter column brreg_bootstrap_floor_date drop default;

update public.app_settings
  set brreg_bootstrap_floor_date = null
  where brreg_bootstrap_floor_date is not null;

comment on column public.app_settings.brreg_bootstrap_floor_date is
  'DEPRECATED 2026-05-06 (PR 7 admin restructure): brreg backfill now loads the full registry with no floor filter. Column kept for migration auditability; readers always see null.';
