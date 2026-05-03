-- 0009_umami_db.sql
-- Phase G: provision a separate `umami` database inside kiba-supabase-db so
-- the kiba-umami container has its own isolated namespace (Umami runs its
-- own Prisma migrations on first boot against this DB).
--
-- We give Umami its own database rather than its own schema so:
--   * its 50+ tables don't pollute `public.*` in PostgREST or in our admin's
--     /admin/data viewer
--   * pg_dump-ing kibarometer's data doesn't carry Umami clickstream rows
--   * Umami can be wiped/re-installed without touching our tables
--
-- Idempotent: psql's \gexec runs the synthesised CREATE DATABASE only when
-- the row exists (i.e. only when the database is missing). On a re-run the
-- inner SELECT yields zero rows and \gexec is a no-op.
--
-- Note: `create database` cannot run inside a transaction or a DO block,
-- which is why we use \gexec rather than a do/exception construct.

select 'create database ' || quote_ident('umami')
where not exists (select 1 from pg_database where datname = 'umami')
\gexec
