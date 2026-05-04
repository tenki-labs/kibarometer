-- 0029_media.sql
-- Schema for the AI media-temperature pipeline (PR 1 of 9 per the approved
-- PRD at ~/.claude/plans/claude-md-i-want-to-compiled-crayon.md).
--
-- Adds:
--   * media_categories         — taxonomy for stance/category classification
--   * media_sources            — outlet registry (RSS, search adapter config,
--                                extractor overrides, backfill cursor)
--   * media_url_queue          — discovered URLs awaiting fetch+classify
--   * media_wire_clusters      — NTB / wire-story de-dup clusters
--   * media_articles           — METADATA + DERIVED ANALYSIS ONLY (never body)
--   * media_snapshot_daily               — per (date, source)
--   * media_snapshot_category_daily      — per (date, category)
--   * media_snapshot_source_category_daily — per (date, source, category)
--   * media_snapshot_index     — daily Kibarometer Index (0–100, 7-day rolling)
--   * media_anomaly_daily      — z-scores per (date, category) with spike flag
--   * refresh_all_media_snapshots()  — orchestrator (truncate+insert pattern)
--
-- Extends:
--   * public.keywords adds `domain text not null default 'jobs'` so the
--     existing keyword catalogue can be shared across the jobs and media
--     pipelines. Universal AI vocabulary is set to domain='any'.
--
-- Seeds:
--   * 12 media categories (Norwegian-first, English labels alongside)
--   * Media-specific keywords (ChatGPT, Anthropic, AI-modell, AI-verktøy,
--     chatbot) — narrow set chosen to minimise FP risk in nav-postings
--     until the matcher learns to filter by domain in a later PR
--   * 2 active sources (Digi.no, Kode24) for adapter validation
--   * 12 inactive sources covering the v1 outlet list — operator activates
--     each one after its search_config is validated
--
-- The body text is NEVER persisted. There is no body / content / text /
-- excerpt / paragraph column on media_articles by design (copyright posture).
--
-- Idempotent. Safe to re-run on every deploy.

-- ── 1. Extend keywords with `domain` ─────────────────────────────────────────

alter table public.keywords add column if not exists domain text;

update public.keywords set domain = 'jobs' where domain is null;

alter table public.keywords alter column domain set default 'jobs';
alter table public.keywords alter column domain set not null;

do $cstr$
begin
  alter table public.keywords
    add constraint keywords_domain_check
      check (domain in ('jobs', 'media', 'any'));
exception when duplicate_object then null;
end $cstr$;

create index if not exists keywords_domain_idx on public.keywords(domain);

-- Promote universal AI vocabulary to domain='any' so it matches in both
-- pipelines without duplication. Match by (term_norm, language) since that's
-- the keywords unique key. Re-runnable.
update public.keywords set domain = 'any'
where (term_norm, language) in (
  ('ai',                          'en'),
  ('ki',                          'no'),
  ('llm',                         'en'),
  ('large language model',        'en'),
  ('språkmodell',                 'no'),
  ('store språkmodeller',         'no'),
  ('kunstig intelligens',         'no'),
  ('artificial intelligence',     'en'),
  ('maskinlæring',                'no'),
  ('machine learning',            'en'),
  ('deep learning',               'en'),
  ('dyp læring',                  'no'),
  ('generative ai',               'en'),
  ('generativ ai',                'no'),
  ('generativ ki',                'no')
)
and domain = 'jobs';

-- Tool / vendor names are universal too (language='any' rows).
update public.keywords set domain = 'any'
where term_norm in (
  'openai', 'claude', 'gemini', 'mistral', 'llama', 'chatgpt'
)
and domain = 'jobs';

-- ── 2. media_categories ─────────────────────────────────────────────────────

create table if not exists public.media_categories (
  slug text primary key,
  label_no text not null,
  label_en text,
  parent_slug text references public.media_categories(slug),
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.media_categories enable row level security;

drop policy if exists media_categories_public_read on public.media_categories;
create policy media_categories_public_read on public.media_categories
  for select using (is_active = true);

-- ── 3. media_sources ────────────────────────────────────────────────────────

create table if not exists public.media_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text unique not null,
  rss_url text,
  backfill_method text not null default 'site_search'
    check (backfill_method in ('site_search', 'sitemap')),
  search_config jsonb,
  sitemap_url text,
  sitemap_index boolean not null default false,
  extractor_config jsonb,
  requires_render boolean not null default false,
  crawl_delay_ms int not null default 1000 check (crawl_delay_ms >= 100),
  is_active boolean not null default true,
  last_polled_at timestamptz,
  backfill_cursor date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.media_sources enable row level security;
-- service-role only; no public RLS

-- ── 4. media_url_queue ──────────────────────────────────────────────────────

create table if not exists public.media_url_queue (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.media_sources(id) on delete cascade,
  url text not null,
  url_hash text not null unique,
  discovered_at timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending', 'fetched', 'failed', 'skipped_keyword')),
  attempts int not null default 0,
  last_error text
);

create index if not exists media_url_queue_pending_idx
  on public.media_url_queue(discovered_at)
  where status = 'pending';

alter table public.media_url_queue enable row level security;

-- ── 5. media_wire_clusters (NTB de-dup) ─────────────────────────────────────
-- Forward-declared without representative_article_id FK; the FK is added
-- after media_articles is created (circular reference between the two).

create table if not exists public.media_wire_clusters (
  id uuid primary key default gen_random_uuid(),
  representative_article_id uuid,
  cluster_size int not null default 1,
  first_seen_at timestamptz not null default now()
);

alter table public.media_wire_clusters enable row level security;

drop policy if exists media_wire_clusters_public_read on public.media_wire_clusters;
create policy media_wire_clusters_public_read on public.media_wire_clusters
  for select using (true);

-- ── 6. media_articles ───────────────────────────────────────────────────────
-- METADATA + DERIVED ANALYSIS ONLY. No body / content / text columns by
-- design — see CLAUDE.md and the PRD.

create table if not exists public.media_articles (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.media_sources(id) on delete cascade,
  url text not null,
  url_hash text not null unique,

  -- factual metadata (not copyrightable)
  published_at timestamptz,
  last_modified_at timestamptz,
  fetched_at timestamptz not null default now(),
  headline text,
  byline text,
  language text,
  word_count int,
  og_image_url text,

  -- classification (Stage 2)
  is_ai_related boolean,
  matched_keywords jsonb,
  match_method text check (match_method in ('keyword', 'llm', 'both')),

  -- extraction quality (Stage 2)
  extraction_quality text
    check (extraction_quality in ('full', 'partial', 'metadata-only', 'extract_failed')),
  extraction_strategy_used text
    check (extraction_strategy_used in ('jsonld', 'amp', 'readability', 'og-only', 'rendered')),

  -- NTB / wire de-dup
  simhash bigint,
  wire_cluster_id uuid references public.media_wire_clusters(id),

  -- LLM Tier 1 (relevance confirmation + AI phrase extraction)
  tier1_completed_at timestamptz,
  llm_ai_phrases jsonb,
  llm_retry_count int not null default 0,

  -- LLM Tier 2 (taxonomy + stance + intensity)
  tier2_completed_at timestamptz,
  llm_categories jsonb,
  llm_stance text
    check (llm_stance in ('enthusiastic', 'alarmed', 'critical', 'neutral-explainer', 'policy-debate', 'personal-story')),
  llm_intensity real check (llm_intensity is null or (llm_intensity >= 0 and llm_intensity <= 1)),
  llm_taxonomy_version text,
  llm_prompt_id uuid,
  llm_model_version text,

  -- lifecycle
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Tier 1 work-queue index (mirrors nav_postings tier1_queue_idx).
create index if not exists media_articles_tier1_queue_idx
  on public.media_articles(created_at)
  where is_ai_related = true
    and tier1_completed_at is null
    and llm_retry_count < 3
    and deleted_at is null;

-- Tier 2 work-queue index. Tier 2 only runs on rows where Tier 1 found AI
-- phrases (false positives from keyword stage are filtered by Tier 1).
create index if not exists media_articles_tier2_queue_idx
  on public.media_articles(tier1_completed_at)
  where tier1_completed_at is not null
    and tier2_completed_at is null
    and llm_retry_count < 3
    and deleted_at is null;

-- Recent-window scan for simhash de-dup (24h window in app code).
create index if not exists media_articles_recent_simhash_idx
  on public.media_articles(published_at desc)
  where simhash is not null and deleted_at is null;

-- Public-page friendly: paginated AI articles by recency.
create index if not exists media_articles_published_at_idx
  on public.media_articles(published_at desc)
  where is_ai_related = true and deleted_at is null;

create index if not exists media_articles_source_id_idx
  on public.media_articles(source_id);

alter table public.media_articles enable row level security;
-- service-role only; the public surface reads from snapshot tables, not
-- this one, to keep article-level data behind the admin boundary.

-- Now add the back-reference FK on media_wire_clusters.
do $cstr$
begin
  alter table public.media_wire_clusters
    add constraint media_wire_clusters_representative_fk
      foreign key (representative_article_id) references public.media_articles(id)
      on delete set null;
exception when duplicate_object then null;
end $cstr$;

-- ── 7. snapshot tables (public-read) ────────────────────────────────────────
-- Mirror the shape from 0027_snapshot_categories_daily.sql: daily granularity,
-- truncate+insert refresh, public-read RLS, primary key on (date, key).

create table if not exists public.media_snapshot_daily (
  published_on date not null,
  source_id uuid not null references public.media_sources(id) on delete cascade,
  total_count int not null,
  ai_count int not null,
  distinct_story_count int not null,
  primary key (published_on, source_id)
);

create table if not exists public.media_snapshot_category_daily (
  published_on date not null,
  category_slug text not null,
  ai_count int not null,
  distinct_story_count int not null,
  temperature real,
  primary key (published_on, category_slug)
);

create table if not exists public.media_snapshot_source_category_daily (
  published_on date not null,
  source_id uuid not null references public.media_sources(id) on delete cascade,
  category_slug text not null,
  ai_count int not null,
  temperature real,
  primary key (published_on, source_id, category_slug)
);

create table if not exists public.media_snapshot_index (
  date date primary key,
  index_value int not null check (index_value between 0 and 100),
  article_count_7d int not null,
  ai_article_count_7d int not null,
  categories_above_water int not null,
  categories_below_water int not null
);

create table if not exists public.media_anomaly_daily (
  date date not null,
  category_slug text not null,
  count int not null,
  baseline_mean real not null,
  baseline_stddev real not null,
  z_score real not null,
  is_spike boolean not null default false,
  primary key (date, category_slug)
);

alter table public.media_snapshot_daily                  enable row level security;
alter table public.media_snapshot_category_daily         enable row level security;
alter table public.media_snapshot_source_category_daily  enable row level security;
alter table public.media_snapshot_index                  enable row level security;
alter table public.media_anomaly_daily                   enable row level security;

drop policy if exists media_snapshot_daily_public_read                  on public.media_snapshot_daily;
drop policy if exists media_snapshot_category_daily_public_read         on public.media_snapshot_category_daily;
drop policy if exists media_snapshot_source_category_daily_public_read  on public.media_snapshot_source_category_daily;
drop policy if exists media_snapshot_index_public_read                  on public.media_snapshot_index;
drop policy if exists media_anomaly_daily_public_read                   on public.media_anomaly_daily;

create policy media_snapshot_daily_public_read                  on public.media_snapshot_daily                  for select using (true);
create policy media_snapshot_category_daily_public_read         on public.media_snapshot_category_daily         for select using (true);
create policy media_snapshot_source_category_daily_public_read  on public.media_snapshot_source_category_daily  for select using (true);
create policy media_snapshot_index_public_read                  on public.media_snapshot_index                  for select using (true);
create policy media_anomaly_daily_public_read                   on public.media_anomaly_daily                   for select using (true);

-- ── 8. refresh functions ────────────────────────────────────────────────────
-- Per-table truncate+insert; called by refresh_all_media_snapshots() in the
-- order: daily → category_daily → source_category_daily → anomaly_daily →
-- index. Anomaly + index depend on category_daily having been refreshed in
-- the same transaction, so order matters.

create or replace function public.refresh_media_snapshot_daily() returns void
language plpgsql security definer set search_path = public as $$
begin
  truncate table public.media_snapshot_daily;
  insert into public.media_snapshot_daily (published_on, source_id, total_count, ai_count, distinct_story_count)
  select
    published_at::date,
    source_id,
    count(*),
    count(*) filter (where is_ai_related),
    count(distinct coalesce(wire_cluster_id::text, id::text)) filter (where is_ai_related)
  from public.media_articles
  where published_at is not null
    and deleted_at is null
  group by published_at::date, source_id;
end;
$$;

-- Per-day, per-category counts and mean temperature. Fans out the inner
-- `categories` array of llm_categories via jsonb_array_elements. The Tier 2
-- writer persists an object `{ categories: [...], rationale, ... }` matching
-- the nav_postings convention (see migration 0028 for the precedent and the
-- bug it fixed); reading callers must address `->'categories'` before unnest.
-- An article with K categories contributes K rows. Temperature = mean(
-- stance_value × intensity) per (date, category).
create or replace function public.refresh_media_snapshot_category_daily() returns void
language plpgsql security definer set search_path = public as $$
begin
  truncate table public.media_snapshot_category_daily;
  insert into public.media_snapshot_category_daily (published_on, category_slug, ai_count, distinct_story_count, temperature)
  select
    a.published_at::date,
    elem->>'slug' as category_slug,
    count(distinct a.id),
    count(distinct coalesce(a.wire_cluster_id::text, a.id::text)),
    avg(
      case a.llm_stance
        when 'alarmed'           then -1.0
        when 'critical'          then -0.5
        when 'neutral-explainer' then  0.0
        when 'policy-debate'     then  0.0
        when 'personal-story'    then  0.0
        when 'enthusiastic'      then  1.0
        else null
      end * a.llm_intensity
    )::real as temperature
  from public.media_articles a
  cross join lateral jsonb_array_elements(coalesce(a.llm_categories->'categories', '[]'::jsonb)) elem
  where a.is_ai_related = true
    and a.tier2_completed_at is not null
    and a.published_at is not null
    and a.deleted_at is null
    and elem->>'slug' is not null
  group by a.published_at::date, elem->>'slug';
end;
$$;

create or replace function public.refresh_media_snapshot_source_category_daily() returns void
language plpgsql security definer set search_path = public as $$
begin
  truncate table public.media_snapshot_source_category_daily;
  insert into public.media_snapshot_source_category_daily (published_on, source_id, category_slug, ai_count, temperature)
  select
    a.published_at::date,
    a.source_id,
    elem->>'slug' as category_slug,
    count(distinct a.id),
    avg(
      case a.llm_stance
        when 'alarmed'           then -1.0
        when 'critical'          then -0.5
        when 'neutral-explainer' then  0.0
        when 'policy-debate'     then  0.0
        when 'personal-story'    then  0.0
        when 'enthusiastic'      then  1.0
        else null
      end * a.llm_intensity
    )::real as temperature
  from public.media_articles a
  cross join lateral jsonb_array_elements(coalesce(a.llm_categories->'categories', '[]'::jsonb)) elem
  where a.is_ai_related = true
    and a.tier2_completed_at is not null
    and a.published_at is not null
    and a.deleted_at is null
    and elem->>'slug' is not null
  group by a.published_at::date, a.source_id, elem->>'slug';
end;
$$;

-- Anomaly detection: rolling 28-day mean + stddev per category (excluding
-- today). z_score = (count - baseline_mean) / baseline_stddev. is_spike
-- when z >= 2.0 AND count >= 5 (the count floor avoids flagging a single
-- article in a sleepy category as a spike).
create or replace function public.refresh_media_anomaly_daily() returns void
language plpgsql security definer set search_path = public as $$
begin
  truncate table public.media_anomaly_daily;
  insert into public.media_anomaly_daily (date, category_slug, count, baseline_mean, baseline_stddev, z_score, is_spike)
  with daily as (
    select published_on as d, category_slug, ai_count
    from public.media_snapshot_category_daily
  ),
  windowed as (
    select
      d.d as date,
      d.category_slug,
      d.ai_count as count,
      coalesce(avg(prev.ai_count), 0) as baseline_mean,
      coalesce(stddev_samp(prev.ai_count), 0) as baseline_stddev
    from daily d
    left join daily prev
      on prev.category_slug = d.category_slug
      and prev.d between (d.d - interval '28 days')::date and (d.d - interval '1 day')::date
    group by d.d, d.category_slug, d.ai_count
  )
  select
    date,
    category_slug,
    count,
    baseline_mean::real,
    baseline_stddev::real,
    case
      when baseline_stddev > 0 then ((count - baseline_mean) / baseline_stddev)::real
      else 0::real
    end,
    case
      when baseline_stddev > 0
        and ((count - baseline_mean) / baseline_stddev) >= 2.0
        and count >= 5
      then true
      else false
    end
  from windowed;
end;
$$;

-- Headline Kibarometer Index (0-100). 7-day rolling mean of per-article
-- temperature, scaled: 50 = balanced, <50 = anxious tilt, >50 = enthusiastic
-- tilt. categories_above_water / below_water count categories with positive /
-- negative temperature on that day (drawn from category_daily).
create or replace function public.refresh_media_snapshot_index() returns void
language plpgsql security definer set search_path = public as $$
begin
  truncate table public.media_snapshot_index;
  insert into public.media_snapshot_index (date, index_value, article_count_7d, ai_article_count_7d, categories_above_water, categories_below_water)
  with article_dates as (
    select distinct published_at::date as d
    from public.media_articles
    where published_at is not null
      and deleted_at is null
  ),
  windowed as (
    select
      ad.d as date,
      count(a.id) as article_count_7d,
      count(a.id) filter (where a.is_ai_related) as ai_article_count_7d,
      avg(
        case a.llm_stance
          when 'alarmed'           then -1.0
          when 'critical'          then -0.5
          when 'neutral-explainer' then  0.0
          when 'policy-debate'     then  0.0
          when 'personal-story'    then  0.0
          when 'enthusiastic'      then  1.0
          else null
        end * a.llm_intensity
      ) as mean_temp
    from article_dates ad
    left join public.media_articles a
      on a.published_at::date between (ad.d - interval '6 days')::date and ad.d
      and a.deleted_at is null
      and a.is_ai_related = true
      and a.tier2_completed_at is not null
    group by ad.d
  ),
  cat_balance as (
    select
      published_on as date,
      count(*) filter (where temperature > 0) as above,
      count(*) filter (where temperature < 0) as below
    from public.media_snapshot_category_daily
    group by published_on
  )
  select
    w.date,
    greatest(0, least(100, round(50 + 50 * coalesce(w.mean_temp, 0))::int)),
    w.article_count_7d,
    w.ai_article_count_7d,
    coalesce(c.above, 0),
    coalesce(c.below, 0)
  from windowed w
  left join cat_balance c on c.date = w.date;
end;
$$;

-- Orchestrator. Order matters: anomaly + index depend on category_daily.
create or replace function public.refresh_all_media_snapshots() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_media_snapshot_daily();
  perform public.refresh_media_snapshot_category_daily();
  perform public.refresh_media_snapshot_source_category_daily();
  perform public.refresh_media_anomaly_daily();
  perform public.refresh_media_snapshot_index();
end;
$$;

-- ── 9. seeds: media_categories ──────────────────────────────────────────────

insert into public.media_categories (slug, label_no, label_en, description) values
  ('policy-regulation',   'Politikk og regulering',  'Policy & regulation',  'EU AI Act, norsk KI-strategi, Datatilsynet, lovverk og forskrifter'),
  ('business-adoption',   'Næringsliv',              'Business adoption',    'Selskaper som tar i bruk eller utvikler AI'),
  ('labour-impact',       'Arbeidsliv',              'Labour impact',        'Permitteringer, ansettelser, etterutdanning, automatisering'),
  ('education',           'Utdanning',               'Education',            'Universiteter, skoler, kompetanseheving og opplæring'),
  ('ethics-bias',         'Etikk og skjevhet',       'Ethics & bias',        'Diskriminering, åpenhet, ansvar og forklaring'),
  ('privacy-security',    'Personvern og sikkerhet', 'Privacy & security',   'GDPR, deepfakes, datalekkasjer, overvåking'),
  ('technical-research',  'Forskning og teknologi',  'Technical research',   'Modellslipp, gjennombrudd, vitenskapelige funn'),
  ('infrastructure',      'Infrastruktur',           'Infrastructure',       'Datasentre, energi, brikker, suverenitet'),
  ('public-sector',       'Offentlig sektor',        'Public sector',        'Forvaltning, helse, NAV, kommuner og fylker'),
  ('tools-vendors',       'Verktøy og leverandører', 'Tools & vendors',      'ChatGPT, Copilot, Claude og andre navngitte produkter'),
  ('creative-industries', 'Kreative næringer',       'Creative industries',  'Journalistikk, kunst, musikk, opphavsrett'),
  ('discourse-opinion',   'Debatt',                  'Discourse & opinion',  'Kommentarer, kronikker, meningsutvekslinger')
on conflict (slug) do nothing;

-- ── 10. seeds: media-specific keywords ──────────────────────────────────────
-- Narrow set chosen to minimise FP risk in the existing nav_postings matcher
-- (which doesn't filter by domain yet). Broader media-only vocabulary
-- (algoritme, automatisering, generativ) is deferred until the matcher learns
-- to filter by domain.

insert into public.keywords (term, language, category, match_type, status, domain, notes) values
  ('ChatGPT',     'any', 'tool',    'word',      'canonical', 'any',   'Specific product name; high precision in both jobs and media.'),
  ('Anthropic',   'any', 'tool',    'word',      'canonical', 'any',   null),
  ('AI-modell',   'no',  'concept', 'substring', 'canonical', 'media', 'Norsk sammensetning. Sjelden i jobbutlysninger.'),
  ('AI-verktøy',  'no',  'concept', 'substring', 'canonical', 'media', 'Norsk sammensetning. Sjelden i jobbutlysninger.'),
  ('chatbot',     'any', 'concept', 'word',      'canonical', 'media', 'Distinct enough that media usage dominates.')
on conflict (term_norm, language) do nothing;

-- ── 11. seeds: media_sources ────────────────────────────────────────────────
-- Two outlets active for adapter validation; remaining v1 list seeded
-- inactive. Operator turns each one on after its search_config + extractor
-- behaviour are confirmed locally.

-- Active for v1 validation: Digi.no + Kode24 (tech press, fully open access,
-- predictable JSON-LD, modest article counts).
insert into public.media_sources
  (name, domain, rss_url, backfill_method, search_config, crawl_delay_ms, is_active, notes)
values
  ('Digi.no', 'digi.no',
   'https://www.digi.no/rss',
   'site_search',
   '{
      "url_template": "https://www.digi.no/sok?q={q}&page={page}",
      "queries": ["AI", "KI", "kunstig intelligens", "ChatGPT", "språkmodell", "maskinlæring"],
      "result_selector": "article a",
      "next_page_selector": "a[rel=next]",
      "max_pages_per_query": 50
    }'::jsonb,
   1500, true,
   'Pilot source — adapter validated in PR 1.'),
  ('Kode24', 'kode24.no',
   'https://www.kode24.no/feed/',
   'site_search',
   '{
      "url_template": "https://www.kode24.no/?q={q}&page={page}",
      "queries": ["AI", "KI", "kunstig intelligens", "ChatGPT", "språkmodell"],
      "result_selector": "article a",
      "next_page_selector": "a[rel=next]",
      "max_pages_per_query": 50
    }'::jsonb,
   1500, true,
   'Pilot source — adapter validated in PR 1.')
on conflict (domain) do nothing;

-- Inactive: rest of v1 outlet list. Operator activates each via the admin UI
-- after seeding its search_config and observing the dry-run.
insert into public.media_sources
  (name, domain, backfill_method, crawl_delay_ms, is_active, notes)
values
  ('Tek.no',           'tek.no',              'site_search', 1500, false, 'Seed search_config before activating.'),
  ('ITavisen',         'itavisen.no',         'site_search', 1500, false, 'Seed search_config before activating.'),
  ('NRK',              'nrk.no',              'site_search', 2000, false, 'Public broadcaster; courteous crawl_delay.'),
  ('E24',              'e24.no',              'site_search', 2000, false, null),
  ('VG',               'vg.no',               'site_search', 2000, false, null),
  ('Dagbladet',        'dagbladet.no',        'site_search', 2000, false, null),
  ('DN',               'dn.no',               'site_search', 2000, false, 'Paywalled — JSON-LD extraction expected to win on most articles.'),
  ('Finansavisen',     'finansavisen.no',     'site_search', 2000, false, 'Paywalled — same as DN.'),
  ('Nettavisen',       'nettavisen.no',       'site_search', 2000, false, null),
  ('Khrono',           'khrono.no',           'site_search', 1500, false, 'Academic press; AI-policy heavy.'),
  ('Forskning.no',     'forskning.no',        'site_search', 1500, false, 'Research aggregator; AI-research heavy.'),
  ('Kommunal Rapport', 'kommunal-rapport.no', 'site_search', 2000, false, 'Public sector specialist.')
on conflict (domain) do nothing;
