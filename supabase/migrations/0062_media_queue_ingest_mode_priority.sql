-- 0062_media_queue_ingest_mode_priority.sql
--
-- Composite index on media_url_queue to support the new ORDER BY
--   ingest_mode DESC, discovered_at ASC
-- in lib/admin/legacy/media-fetch-classify.js. Reason: media-fetch-
-- classify will now drain 'live' rows before 'backfill' rows so a
-- 2020-onwards sitemap dump can't starve today's fresh URLs in the
-- queue. PostgREST text collation puts 'backfill' < 'live'
-- alphabetically, so we use DESC to land on 'live' first.
--
-- Partial index on status='pending' to match the existing
-- media_url_queue_pending_idx pattern — the queue is huge in absolute
-- size after archive backfills, but the pending slice is small.
--
-- Idempotent.

create index if not exists media_url_queue_pending_priority_idx
  on public.media_url_queue (ingest_mode desc, discovered_at asc)
  where status = 'pending';
