-- scripts/sql/wipe-pre-2024-data.sql
--
-- One-shot data reset, run MANUALLY on the VPS once after the
-- feat/backfill-button-cron-toggle PR is deployed. NOT idempotent in
-- the migration sense — re-running wipes any data the BACKFILL button
-- has since drained.
--
-- Why: nav_postings was dominated by NAV's 2023-06-14 historical
-- migration with bogus posted_at = 2023-06-14 and original publication
-- dates spanning 2010-2023 (mostly pre-ChatGPT, irrelevant to the
-- AI-adoption analysis). The new BACKFILL button fast-forwards past
-- this burst and ingests only postings with last_event_at >=
-- 2024-01-01. Wiping the stale data first means dashboards reflect
-- only the new clean ingest.
--
-- What it touches:
--   * nav_raw, nav_postings — payloads + extracted postings
--   * snapshot_* — derived dashboard tables (rebuilt by the daily
--     refresh-snapshots cron)
--   * keyword_candidates — derived from nav_postings
--   * jobs rows for backfill/fetch/enrich/reprocess — orchestration
--     history; the BACKFILL button starts from cursor=null without it
--
-- What it does NOT touch:
--   * keywords, taxonomy_categories, taxonomy_versions, llm_prompts,
--     site_content, mlx_health, profiles — manually curated or system
--     state, must persist across the wipe
--   * Other job rows (refresh-snapshots, llm-discover, llm-classify)
--
-- Run via:
--   PGPW=$(grep '^POSTGRES_PASSWORD=' /opt/kibarometer/env/supabase.env | cut -d= -f2)
--   docker exec -i -e PGPASSWORD="$PGPW" kiba-supabase-db \
--     psql -U postgres -d postgres < /opt/kibarometer/website/scripts/sql/wipe-pre-2024-data.sql

begin;

truncate
  public.nav_raw,
  public.nav_postings,
  public.snapshot_daily,
  public.snapshot_monthly,
  public.snapshot_keywords,
  public.snapshot_geography,
  public.snapshot_category,
  public.snapshot_headline,
  public.snapshot_skill_categories,
  public.keyword_candidates
restart identity cascade;

delete from public.jobs
 where name in (
   'backfill_nav_stillingsfeed',
   'fetch_nav_stillingsfeed',
   'enrich_nav_postings',
   'reprocess_nav_postings'
 );

select 'nav_raw' as tbl, count(*) from public.nav_raw
union all select 'nav_postings', count(*) from public.nav_postings
union all select 'jobs (post-wipe)', count(*) from public.jobs;

commit;
