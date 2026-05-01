-- 0005_jobs.sql
-- Run-log for background jobs (NAV fetch, future analysis recompute, etc.).
-- Idempotent.
--
-- Migration numbers 0003/0004 are reserved for Phase 8 (nav_normalized,
-- snapshots) per the implementation plan. The deploy migration loop is
-- tolerant of gaps.

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  trigger text not null default 'manual'
    check (trigger in ('manual', 'cron')),
  status text not null default 'running'
    check (status in ('running', 'success', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  rows_processed int,
  error text
);

create index if not exists jobs_name_started_at_idx
  on public.jobs (name, started_at desc);
create index if not exists jobs_status_idx
  on public.jobs (status) where status = 'running';

alter table public.jobs enable row level security;

drop policy if exists jobs_staff_read on public.jobs;
create policy jobs_staff_read on public.jobs for select using (public.is_staff());
