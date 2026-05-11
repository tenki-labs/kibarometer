-- Loosen public.jobs.trigger CHECK to allow 'post-reprocess'.
--
-- PR #131 wired reprocessNavPostings to chain into refreshSnapshots on
-- success, passing trigger='post-reprocess' so the chained refresh row
-- is distinguishable from manual / cron / fast-forward triggers on
-- /admin/processes. The CHECK constraint set in 0005 (and last touched
-- in 0025) didn't include this value, so every chained refresh POST
-- returns 400 and the chain never fires. Symptom: /admin/processes
-- shows reprocess_nav_postings success with metadata.refresh_error
-- "violates check constraint jobs_trigger_check", refresh_job_id null,
-- and the operator has to click Refresh snapshots manually for the
-- /jobbmarked dashboard to reflect the retag.
--
-- Idempotent: drop-then-add the named constraint.

alter table public.jobs drop constraint if exists jobs_trigger_check;
alter table public.jobs add constraint jobs_trigger_check
  check (trigger in ('manual', 'cron', 'fast-forward', 'post-reprocess'));
