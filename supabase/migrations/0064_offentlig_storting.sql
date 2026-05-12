-- 0064_offentlig_storting.sql
-- First migration of the /offentlig pillar (fourth kibarometer pillar). Lands
-- the Stortinget half of the ingest backend; the Doffin half follows in a
-- later migration once DFØ API access is in hand (eForms XML response shape
-- needs to be inspected before that schema is locked down).
--
-- Source: data.stortinget.no — open data, no auth, JSON via ?format=json.
--   /eksport/saker?sesjonid=YYYY-YYYY        → parliamentary cases
--   /eksport/stortingsvedtak?sesjonid=...    → resolutions linked by sak_id
--
-- Field names and types follow the live API verified 2026-05-12. Codes that
-- appear as integers in the API response (type, status, dokumentgruppe) are
-- stored as smallint here without enum mapping; labels are derived in the
-- admin/public layer or in a future enrichment migration once the full code
-- domains are known. stortingsvedtak_type.id is a string ("ANMOD" etc.) and
-- IS stored verbatim.
--
-- Tables:
--   storting_saker      — cases (PK sak_id)
--   storting_vedtak     — resolutions (PK vedtak_id, FK → saker)
--   storting_categories — taxonomy (B2 Tier 2 target; seeded inactive so the
--                         migration is harmless even before LLM wiring lands)
--
-- AI flagging mirrors NAV/BRREG: keyword matcher applies to (tittel +
-- korttittel) for saker (has_ai_in_title) and to flattened emne_liste names
-- (has_ai_in_emner); for vedtak it applies to the stripped-text version of
-- stortingsvedtak_tekst. is_ai_relevant is GENERATED so a keyword catalog
-- change followed by a retag rewrites the boolean for free.
--
-- Idempotent.

-- ============================================================
-- 1. Extend keywords.domain check to include 'offentlig'.
--    Mirrors the pattern from 0040_keyword_candidates_brreg.sql where
--    each new pillar widens the constraint.
-- ============================================================

do $domain$
begin
  alter table public.keywords
    drop constraint if exists keywords_domain_check;
  alter table public.keywords
    add constraint keywords_domain_check
      check (domain in ('jobs', 'media', 'brreg', 'offentlig', 'any'));
end $domain$;

-- ============================================================
-- 2. storting_saker — parliamentary cases. Forward-poll the active session
--    daily; backfill walks sessions back to 2018-2019 (first session that
--    covers 2019-01-01, the /offentlig pillar's data floor).
--
--    PK is the upstream sak.id (bigint — observed integers > 2^31 are
--    unlikely but safer to widen). Re-ingest is an upsert on PK; last_seen_at
--    bumps so we can detect entries the upstream API stopped returning.
-- ============================================================

create table if not exists public.storting_saker (
  sak_id bigint primary key,

  -- Headline fields (free text)
  tittel text not null,
  korttittel text,
  henvisning text,

  -- Numeric codes (left as integers; label resolution deferred to UI layer)
  type_kode smallint,
  status_kode smallint,
  dokumentgruppe_kode smallint,
  innstilling_id bigint,
  innstilling_kode smallint,
  sak_fremmet_id bigint,

  -- Session context
  sesjon_id text,
  behandlet_sesjon_id text,

  -- Lifecycle date from upstream
  sist_oppdatert_dato date,

  -- Komite (flattened — most queries want id or navn, not the rest)
  komite_id bigint,
  komite_navn text,

  -- Object/array fields preserved as jsonb (small enough not to pay)
  forslagstiller_liste jsonb,
  emne_liste jsonb,
  saksordfoerer_liste jsonb,

  -- Keyword AI tagging
  has_ai_in_title boolean not null default false,
  has_ai_in_emner boolean not null default false,
  is_ai_relevant boolean generated always as (has_ai_in_title or has_ai_in_emner) stored,
  matched_keywords_title text[] not null default array[]::text[],
  matched_keywords_emner text[] not null default array[]::text[],

  -- LLM Tier 1 (verbatim phrase extraction; live ingest only)
  tier1_completed_at timestamptz,
  llm_ai_phrases jsonb,
  llm_retry_count smallint not null default 0,

  -- LLM Tier 2 (taxonomy slug assignment)
  tier2_completed_at timestamptz,
  llm_categories jsonb,
  llm_taxonomy_version text,
  llm_prompt_id bigint,
  llm_model_version text,

  -- Lifecycle
  ingested_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  retagged_at timestamptz,
  ingest_mode text not null default 'live' check (ingest_mode in ('live','backfill')),

  -- Full upstream object for re-derive when columns shift
  raw_jsonb jsonb
);

create index if not exists storting_saker_sist_oppdatert_idx
  on public.storting_saker (sist_oppdatert_dato desc);

create index if not exists storting_saker_ai_relevant_idx
  on public.storting_saker (sist_oppdatert_dato desc)
  where is_ai_relevant;

create index if not exists storting_saker_session_idx
  on public.storting_saker (sesjon_id);

-- Tier work queues. Mirror media_articles_tierN_queue_idx (0029_media.sql).
create index if not exists storting_saker_tier1_queue_idx
  on public.storting_saker (ingested_at desc)
  where is_ai_relevant
    and tier1_completed_at is null
    and llm_retry_count < 3
    and ingest_mode = 'live';

create index if not exists storting_saker_tier2_queue_idx
  on public.storting_saker (tier1_completed_at asc)
  where tier1_completed_at is not null
    and tier2_completed_at is null
    and llm_retry_count < 3;

alter table public.storting_saker enable row level security;

-- Base table is staff-only; the marketing /offentlig page reads pre-computed
-- snapshot tables (added in a later migration once Doffin lands).
drop policy if exists storting_saker_staff_read on public.storting_saker;
create policy storting_saker_staff_read on public.storting_saker
  for select using (public.is_staff());

-- ============================================================
-- 3. storting_vedtak — resolutions linked to saker. Tier 1/2 enrichment
--    travels via the parent sak, not the vedtak, so the LLM-output columns
--    intentionally aren't repeated here.
-- ============================================================

create table if not exists public.storting_vedtak (
  vedtak_id bigint primary key,
  sak_id bigint references public.storting_saker(sak_id) on delete cascade,
  sesjon_id text,

  nummer smallint,
  dato_tid timestamptz,

  tittel text,
  -- stortingsvedtak_tekst from upstream is HTML; ingest stores HTML verbatim
  -- and the keyword matcher operates on a tag-stripped form (computed in
  -- storting-processor.js, NOT persisted — re-strip on retag is cheap).
  tekst text,

  -- stortingsvedtak_type.id is a string like 'ANMOD' / 'ANNET' / 'BUDSJETT' /
  -- 'GRUNNLOV' / 'RO'. Stored verbatim — observed values come from the upstream
  -- catalog and a future enrichment migration can label-map them.
  type_id text,
  type_navn text,

  -- Direct links from upstream
  sak_lenke_url text,
  vedtak_lenke_url text,

  -- Keyword AI tagging on (stripped) text
  has_ai_in_text boolean not null default false,
  is_ai_relevant boolean generated always as (has_ai_in_text) stored,
  matched_keywords text[] not null default array[]::text[],

  ingested_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  retagged_at timestamptz,
  ingest_mode text not null default 'live' check (ingest_mode in ('live','backfill')),

  raw_jsonb jsonb
);

create index if not exists storting_vedtak_sak_id_idx
  on public.storting_vedtak (sak_id);

create index if not exists storting_vedtak_dato_idx
  on public.storting_vedtak (dato_tid desc);

create index if not exists storting_vedtak_ai_relevant_idx
  on public.storting_vedtak (dato_tid desc)
  where is_ai_relevant;

alter table public.storting_vedtak enable row level security;

drop policy if exists storting_vedtak_staff_read on public.storting_vedtak;
create policy storting_vedtak_staff_read on public.storting_vedtak
  for select using (public.is_staff());

-- ============================================================
-- 4. storting_categories — taxonomy for Tier 2 slug assignment. Edited via
--    /admin/offentlig/categories?tab=storting (admin UI lands in B2).
--    Seeded with policy-flavoured slugs that mirror the per-sak shape better
--    than the procurement-flavoured doffin_categories. Mappings between the
--    two taxonomies land in a later migration via category_mappings.
-- ============================================================

create table if not exists public.storting_categories (
  slug text primary key,
  label_no text not null,
  label_en text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists storting_categories_updated_at on public.storting_categories;
create trigger storting_categories_updated_at before update on public.storting_categories
  for each row execute function public.trigger_set_updated_at();

create index if not exists storting_categories_active_idx
  on public.storting_categories (sort_order)
  where is_active;

alter table public.storting_categories enable row level security;

drop policy if exists storting_categories_public_read on public.storting_categories;
create policy storting_categories_public_read on public.storting_categories
  for select using (is_active = true);

drop policy if exists storting_categories_staff_read on public.storting_categories;
create policy storting_categories_staff_read on public.storting_categories
  for select using (public.is_staff());

drop policy if exists storting_categories_admin_write on public.storting_categories;
create policy storting_categories_admin_write on public.storting_categories
  for all using (public.is_admin_or_super())
  with check (public.is_admin_or_super());

-- Seed: initial taxonomy. Marked active=true so /admin/offentlig/categories
-- shows them out of the box; operators refine via the admin UI without
-- another deploy. Slugs chosen to be policy-shaped (not 1:1 with doffin's
-- procurement-shaped slugs).
insert into public.storting_categories (slug, label_no, label_en, sort_order) values
  ('ai-regulering',                'AI-regulering og lovgivning',           'AI regulation and legislation',     10),
  ('ai-strategi',                  'AI-strategi og nasjonal innsats',       'AI strategy and national effort',   20),
  ('ai-budsjett',                  'AI-bevilgninger og budsjett',           'AI funding and budget',             30),
  ('ai-helsepolitikk',             'AI i helsesektoren',                    'AI in health sector',               40),
  ('ai-utdanningspolitikk',        'AI i utdanning og forskning',           'AI in education and research',      50),
  ('ai-forvaltningspolitikk',      'AI i offentlig forvaltning',            'AI in public administration',       60),
  ('ai-arbeidslivspolitikk',       'AI i arbeidsliv og kompetanse',         'AI in workforce and skills',        70),
  ('ai-forsvarspolitikk',          'AI i forsvar og sikkerhet',             'AI in defence and security',        80),
  ('ai-samferdsel',                'AI i samferdsel og infrastruktur',      'AI in transport and infrastructure',90),
  ('ai-etikk-personvern',          'AI-etikk og personvern',                'AI ethics and privacy',            100),
  ('annet',                        'Annet / uklassifisert',                 'Other / unclassified',             999)
on conflict (slug) do nothing;
