-- 0036_media_retagged_at.sql
-- Adds `retagged_at` to `media_articles` so the manual keyword-mapping
-- reprocess (lib/admin/legacy/media-reprocess.js) can stamp rows it
-- touched, mirroring nav_postings.retagged_at on the NAV side.
--
-- Idempotent.

alter table public.media_articles
  add column if not exists retagged_at timestamptz;
