-- 0024_app_settings.sql
-- Single-row settings table for runtime-toggleable flags. The single-row
-- pattern (id=1 enforced via check constraint) gives us a known location
-- to read/write without managing keys. Currently used for the
-- cron-paused toggle on /admin/jobs — when true, the bearer-authed
-- /admin/api/jobs/backfill-nav route returns noop without calling
-- backfillNav. This is a soft pause; the cron in kiba-fetcher still
-- ticks at its scheduled time.
--
-- Future flags can be added as boolean columns; readers should select
-- only the flag(s) they need.
--
-- Idempotent.

create table if not exists public.app_settings (
  id int primary key default 1,
  cron_paused boolean not null default false,
  updated_at timestamptz not null default now(),
  check (id = 1)
);

insert into public.app_settings (id) values (1) on conflict (id) do nothing;

alter table public.app_settings enable row level security;

-- Staff read so the admin page can show the current state. Writes go
-- through the service-role key (bypasses RLS) — no insert/update policy
-- needed. Same pattern as nav_raw, nav_postings.
drop policy if exists app_settings_staff_read on public.app_settings;
create policy app_settings_staff_read on public.app_settings
  for select using (public.is_staff());
