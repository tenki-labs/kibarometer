-- 0013_admin_list_columns.sql
-- Phase G: column-listing RPC for the /admin/database table viewer. The
-- viewer used to do `select=*` blindly, which 502s on tables with big
-- jsonb payloads (notably nav_raw.payload — multi-MB per row × 100 rows
-- exceeds Kong's upstream window). With column metadata in hand the
-- viewer can project away json / jsonb columns by default and display a
-- "N JSON-kolonner skjult" banner.
--
-- Same trust boundary as admin_list_tables: SECURITY DEFINER, executable
-- only by service_role (the admin always reaches PostgREST with the
-- service-role key via lib/admin/sb.ts).
--
-- Idempotent.

create or replace function public.admin_list_table_columns(p_table text)
returns table (
  column_name text,
  data_type text
)
language sql
security definer
set search_path = public, pg_catalog
as $$
  select
    c.column_name::text,
    c.data_type::text
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = p_table
    -- Same denylist as admin_list_tables() — defence in depth even though
    -- the route already refuses to render these table names.
    and c.table_name not like '%token%'
    and c.table_name not like '%secret%'
    and c.table_name not like '%password%'
  order by c.ordinal_position;
$$;

revoke all on function public.admin_list_table_columns(text) from public, anon, authenticated;
grant execute on function public.admin_list_table_columns(text) to service_role;
