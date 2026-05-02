-- 0006a_jobs_metadata.sql
-- Phase B (historical NAV backfill): persist per-batch state on backfill jobs.
-- Each backfill_nav_stillingsfeed row stores its start cursor, next cursor,
-- pages_fetched, last_event_at, and a `completed` flag the cron uses to
-- short-circuit once we've caught the live head. One nullable column, idempotent.
--
-- Suffixed `a` to coexist with Phase A's 0006_keywords.sql in a parallel PR.

alter table public.jobs add column if not exists metadata jsonb;
