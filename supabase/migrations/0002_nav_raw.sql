-- 0002_nav_raw.sql
-- Raw NAV API payloads. One row per fetch. The shape we'll normalise from is
-- decided in Phase 8 once we've seen real production payloads — for now we
-- just store the JSON intact so nothing is lost.
-- Idempotent.

create table if not exists public.nav_raw (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null,
  params jsonb not null default '{}'::jsonb,
  payload jsonb not null,
  http_status int not null,
  duration_ms int,
  fetched_at timestamptz not null default now()
);

create index if not exists nav_raw_endpoint_fetched_at_idx
  on public.nav_raw (endpoint, fetched_at desc);

alter table public.nav_raw enable row level security;

-- Staff can read for admin inspection. Writes go through the service-role key
-- (admin server), which bypasses RLS — no insert policy needed.
drop policy if exists nav_raw_staff_read on public.nav_raw;
create policy nav_raw_staff_read on public.nav_raw for select using (public.is_staff());
