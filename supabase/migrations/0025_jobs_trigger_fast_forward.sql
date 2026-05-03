-- Loosen public.jobs.trigger CHECK to allow 'fast-forward'.
--
-- PR #41 introduced fastForwardNav/backfillNav inserts with
-- trigger='fast-forward' (per-batch rows owned by the BACKFILL drain),
-- but never updated the CHECK constraint set in 0005_jobs.sql, which
-- only allows ('manual', 'cron'). The bug never surfaced in PR #41
-- because the cron caught the feed up to live head before the operator
-- clicked BACKFILL — every click saw metadata.completed=true and the
-- action's loop bailed before fastForwardNav ran. Now that the wipe
-- has reset state, the next click will actually exercise the path.
--
-- Idempotent: drop-then-add the named constraint.

alter table public.jobs drop constraint if exists jobs_trigger_check;
alter table public.jobs add constraint jobs_trigger_check
  check (trigger in ('manual', 'cron', 'fast-forward'));
