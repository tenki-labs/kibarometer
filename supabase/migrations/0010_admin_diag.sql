-- 0010_admin_diag.sql
-- Phase G: helper RPCs for the new /admin/diagnostics and /admin/data pages.
--   * admin_table_sizes() — per-table size + row estimate for the diagnostics
--     "Postgres footprint" card. Reads pg_class / pg_namespace, which require
--     elevated rights — hence SECURITY DEFINER.
--   * admin_list_tables() — public.* tables that the /admin/data viewer is
--     allowed to render. Excludes anything we don't want surfaced (auth.*,
--     storage.*, supabase internals are filtered by schema = 'public').
--
-- Both functions are SECURITY DEFINER and granted to `service_role` only.
-- The admin always reaches PostgREST with the service-role key (lib/admin/sb.ts
-- with `service: true`), so this is the same trust boundary as every other
-- /rpc/* in the system.
--
-- Idempotent.

create or replace function public.admin_table_sizes()
returns table (
  schema_name text,
  table_name text,
  total_bytes bigint,
  row_estimate bigint
)
language sql
security definer
set search_path = public, pg_catalog
as $$
  select
    n.nspname::text                                  as schema_name,
    c.relname::text                                  as table_name,
    pg_total_relation_size(c.oid)::bigint            as total_bytes,
    coalesce(c.reltuples, 0)::bigint                 as row_estimate
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r'
    and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
  order by pg_total_relation_size(c.oid) desc;
$$;

create or replace function public.admin_list_tables()
returns table (
  table_name text,
  row_estimate bigint
)
language sql
security definer
set search_path = public, pg_catalog
as $$
  select
    c.relname::text                                  as table_name,
    coalesce(c.reltuples, 0)::bigint                 as row_estimate
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r'
    and n.nspname = 'public'
    -- Hide anything obviously sensitive even at the schema level. PostgREST
    -- + the service-role key would technically let an admin read these
    -- through the same /admin/data viewer, but we'd rather not surface them
    -- in the picker by default.
    and c.relname not like '%token%'
    and c.relname not like '%secret%'
    and c.relname not like '%password%'
  order by c.relname;
$$;

-- Lock down execution to the PostgREST service-role grant chain. Anon key
-- callers get function-not-found, not "permission denied" leaking the name.
revoke all on function public.admin_table_sizes() from public, anon, authenticated;
revoke all on function public.admin_list_tables() from public, anon, authenticated;
grant execute on function public.admin_table_sizes() to service_role;
grant execute on function public.admin_list_tables() to service_role;
