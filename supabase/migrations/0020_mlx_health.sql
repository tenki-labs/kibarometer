-- 0020_mlx_health.sql
-- Single-row health table for the mlx.tenki.no LLM endpoint. Updated by
-- mlxChat() in lib/admin/mlx.ts on every call so /admin/llm renders a
-- fleet-wide tunnel state — module-scoped state in lib/admin/mlx.ts would
-- not survive across Next.js worker processes.
--
-- Idempotent.

create table if not exists public.mlx_health (
  id int primary key default 1,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  model_id text,
  updated_at timestamptz not null default now(),
  constraint mlx_health_singleton check (id = 1)
);

insert into public.mlx_health (id) values (1) on conflict (id) do nothing;

alter table public.mlx_health enable row level security;

drop policy if exists mlx_health_staff_read on public.mlx_health;
create policy mlx_health_staff_read on public.mlx_health
  for select using (public.is_staff());
