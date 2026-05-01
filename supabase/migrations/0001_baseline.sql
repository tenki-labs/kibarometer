-- 0001_baseline.sql
-- Profiles + role helpers + auth-driven profile insert trigger.
-- Idempotent: re-running is safe.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'employee'
    check (role in ('super_admin', 'admin', 'employee', 'read_only')),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create or replace function public.trigger_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists profiles_updated_at on profiles;
create trigger profiles_updated_at before update on profiles
  for each row execute function trigger_set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email),
          coalesce(new.raw_user_meta_data->>'role', 'employee'))
  on conflict (id) do update
    set full_name = excluded.full_name, role = excluded.role;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- Role helpers (security definer)
create or replace function public.has_role(roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = any(roles));
$$;
create or replace function public.is_super_admin()
returns boolean language sql stable as $$ select has_role(array['super_admin']); $$;
create or replace function public.is_admin_or_super()
returns boolean language sql stable as $$ select has_role(array['super_admin','admin']); $$;
create or replace function public.is_staff()
returns boolean language sql stable as $$
  select has_role(array['super_admin','admin','employee','read_only']);
$$;

-- profiles RLS: staff read all, users self-update
drop policy if exists profiles_staff_read on public.profiles;
create policy profiles_staff_read on public.profiles for select using (public.is_staff());

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
