-- 0023_nav_postings_nav_raw_id_idx.sql
-- Index on nav_postings.nav_raw_id for the FK ON DELETE SET NULL declared in
-- 0007_nav_postings.sql. Without it, any DELETE from nav_raw triggers a seq
-- scan of nav_postings to find rows referencing the deleted nav_raw id —
-- with ~560k postings in production a single 3.5k-row dedupe took >7 min
-- and held locks long enough to wedge concurrent backfill batches. With the
-- index the same dedupe completes in <1 s. Investigation 2026-05-03.
--
-- Idempotent.

create index if not exists nav_postings_nav_raw_id_idx
  on public.nav_postings (nav_raw_id);
