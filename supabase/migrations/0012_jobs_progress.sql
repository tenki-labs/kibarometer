-- 0012_jobs_progress.sql
-- Phase G: live progress fields for the jobs table so /admin/jobs/[id] can
-- render a real progress bar + ETA while a long-running orchestrator is in
-- flight.
--
-- Orchestrators in lib/admin/legacy/jobs.js call `heartbeat(jobId, {pct, step})`
-- between batches; that helper PATCHes these three columns on the row.
-- sweepStaleRunningJobs() will also start considering last_heartbeat so a
-- job that hangs mid-batch (rather than dying outright) gets swept too.
--
-- Idempotent.

alter table public.jobs
  add column if not exists progress_pct numeric;        -- 0..100, null = unknown
alter table public.jobs
  add column if not exists current_step text;           -- e.g. "fetching page 12/40"
alter table public.jobs
  add column if not exists last_heartbeat timestamptz;  -- bumped each tick

-- Range guard. Cheap insurance against a buggy heartbeat call writing 9000.
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'jobs_progress_pct_range'
  ) then
    alter table public.jobs
      add constraint jobs_progress_pct_range
      check (progress_pct is null or (progress_pct >= 0 and progress_pct <= 100));
  end if;
end $$;
