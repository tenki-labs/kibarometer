-- 0075_nav_archive.sql
--
-- Archive enrichment for nav_postings (see CLAUDE.md §2 "NAV pillar data
-- limitations"). NAV's feed API never returns description text for
-- INACTIVE ads, but the same ad page survives in three other places:
--
--   1. arbeidsplassen.nav.no itself keeps serving inactive ads (full text)
--      for roughly five months after `expires` (measured 2026-09-13:
--      expires 2026-03-30 -> 404, expires 2026-04-20 -> 200).
--   2. Common Crawl holds ~117k unique ad pages captured 2024-2026.
--   3. The Wayback Machine holds ~140k unique ad pages captured 2024-2026.
--
-- This migration adds:
--   * provenance + bookkeeping columns on nav_postings,
--   * nav_archive_index: one row per (posting, source, capture) with the
--     locator needed to fetch the archived page (WARC filename/offset/length
--     for Common Crawl, capture timestamp for Wayback),
--   * nav_archive_index_runs: which index sources have been pulled, so the
--     weekly indexer skips immutable Common Crawl crawls it already has,
--   * nav_archive_queue: the view archiveEnrichNav drains.
--
-- Idempotent.

alter table public.nav_postings
  add column if not exists description_source text
    check (description_source in ('nav_api','live_page','commoncrawl','wayback'));
alter table public.nav_postings
  add column if not exists archive_checked_at timestamptz;
-- 'live_miss'            live page returned 404 (ad older than retention)
-- 'archive_miss'         every indexed capture failed to yield a description
-- 'found:<source>'       description recovered from <source>
alter table public.nav_postings
  add column if not exists archive_result text;

-- Rows enriched through the feed API before this migration. Re-runs on
-- every deploy and touches only stragglers (enrichNav stamps 'nav_api'
-- from now on), so the steady-state cost is a no-op index scan.
update public.nav_postings
  set description_source = 'nav_api'
  where description is not null and description_source is null;

-- Live-page pass: rows never tried, newest first (newest rows are the
-- ones the public site actually displays, and the only ones the live
-- page can still serve).
create index if not exists nav_postings_archive_live_idx
  on public.nav_postings (posted_at desc)
  where description is null and archive_result is null;

-- Join side of nav_archive_queue.
create index if not exists nav_postings_no_description_idx
  on public.nav_postings (id)
  where description is null;

create table if not exists public.nav_archive_index (
  id text not null,
  source text not null check (source in ('commoncrawl','wayback')),
  captured_at timestamptz not null,
  -- commoncrawl: {crawl, filename, offset, length}
  -- wayback:     {timestamp, url}
  locator jsonb not null default '{}'::jsonb,
  indexed_at timestamptz not null default now(),
  primary key (id, source, captured_at)
);

create index if not exists nav_archive_index_id_idx
  on public.nav_archive_index (id);

create table if not exists public.nav_archive_index_runs (
  -- 'commoncrawl:CC-MAIN-2025-30' | 'wayback:2025-06'
  source_key text primary key,
  indexed_at timestamptz not null default now(),
  rows_indexed int not null default 0,
  metadata jsonb
);

alter table public.nav_archive_index enable row level security;
alter table public.nav_archive_index_runs enable row level security;

drop policy if exists nav_archive_index_staff_read on public.nav_archive_index;
create policy nav_archive_index_staff_read on public.nav_archive_index
  for select using (public.is_staff());

drop policy if exists nav_archive_index_runs_staff_read on public.nav_archive_index_runs;
create policy nav_archive_index_runs_staff_read on public.nav_archive_index_runs
  for select using (public.is_staff());

-- Drain queue for archiveEnrichNav. One row per (posting, capture); the
-- orchestrator orders by source asc (commoncrawl before wayback — no rate
-- limit vs ~1 req/s) then captured_at desc and takes the first per id.
--
-- A posting re-enters the queue after an 'archive_miss' only when a newer
-- index pull adds captures it has not seen (indexed_at > archive_checked_at).
--
-- security_invoker so anon/authenticated callers are bound by the RLS of
-- the underlying tables (nav_archive_index has no public policy, so the
-- view is empty for them); the service role bypasses RLS as usual.
drop view if exists public.nav_archive_queue;
create view public.nav_archive_queue
  with (security_invoker = true) as
select
  p.id,
  p.title,
  p.posted_at,
  p.archive_result,
  p.archive_checked_at,
  i.source,
  i.captured_at,
  i.locator,
  i.indexed_at
from public.nav_postings p
join public.nav_archive_index i on i.id = p.id
where p.description is null
  and (
    p.archive_result is null
    or p.archive_result = 'live_miss'
    or (p.archive_result = 'archive_miss' and i.indexed_at > p.archive_checked_at)
  );
