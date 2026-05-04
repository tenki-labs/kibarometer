-- 0030_brreg.sql
-- /oppstart pipeline: ingest + analyze newly registered Norwegian companies
-- from Brønnøysundregistrene (brreg). Mirrors the NAV pipeline's shape
-- (incremental upsert into base tables, nightly truncate+insert into
-- snapshot tables). See plan: .claude/plans/i-want-to-create-floating-dongarra.md
--
-- Five base tables (persistent, accumulating):
--   brreg_companies, brreg_roles, brreg_url_queue,
--   nace_categories, kommune_fylke
--
-- Five snapshot tables (recomputed nightly, public-read):
--   brreg_snapshot_headline, brreg_snapshot_daily, brreg_snapshot_geography,
--   brreg_snapshot_focus_daily, brreg_snapshot_cohort
--
-- One refresh orchestrator: refresh_all_brreg_snapshots().
--
-- app_settings extension: brreg_bootstrap_floor_date,
-- brreg_young_founder_age_max, brreg_roles_retention_years.
--
-- A handful of brreg-specific keyword tokens (vibe, agentic, prompt, bot,
-- automation) are seeded into the existing public.keywords table so the
-- shared loadActiveKeywords() in nav-processor.js will surface them. The
-- /oppstart processor will run the same matcher twice per company (once on
-- name, once on aktivitet text). The keywords.domain split is deferred to
-- the /mediedekning migration since it's the first pipeline that needs
-- domain-scoped keywords.
--
-- Idempotent.

-- ============================================================
-- 1. nace_categories — collapse SN2007/SN2025-09 (~700 codes) into ~13
--    kibarometer-level groupings. enrich_roles toggles whether companies
--    in the category get role-fetched (drives the founder-age view).
-- ============================================================

create table if not exists public.nace_categories (
  slug text not null,
  taxonomy_version text not null check (taxonomy_version in ('sn2007', 'sn2025-09')),
  label_no text not null,
  label_en text,
  code_prefixes text[] not null,
  enrich_roles boolean not null default false,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (slug, taxonomy_version)
);

create index if not exists nace_categories_active_idx
  on public.nace_categories (taxonomy_version, sort_order)
  where is_active;

drop trigger if exists nace_categories_updated_at on public.nace_categories;
create trigger nace_categories_updated_at before update on public.nace_categories
  for each row execute function public.trigger_set_updated_at();

alter table public.nace_categories enable row level security;

drop policy if exists nace_categories_public_read on public.nace_categories;
create policy nace_categories_public_read on public.nace_categories
  for select using (is_active = true);

drop policy if exists nace_categories_staff_read on public.nace_categories;
create policy nace_categories_staff_read on public.nace_categories
  for select using (public.is_staff());

drop policy if exists nace_categories_admin_write on public.nace_categories;
create policy nace_categories_admin_write on public.nace_categories
  for all using (public.is_admin_or_super())
  with check (public.is_admin_or_super());

-- Seed: SN2007 categories. Prefixes are 2-digit næringskode prefixes.
-- The processor matches an entity's naeringskode_1 (e.g. "62.010")
-- against any prefix in the array (e.g. "62") via starts_with logic.
insert into public.nace_categories (slug, taxonomy_version, label_no, label_en, code_prefixes, enrich_roles, sort_order) values
  ('it',           'sn2007', 'Informasjonsteknologi',           'Information technology',          array['62','63'],                              true,  10),
  ('kreativ-media','sn2007', 'Media og kreativ næring',         'Media and creative industries',   array['58','59','60','90','91','92','93'],     true,  20),
  ('tjenester',    'sn2007', 'Faglige og tekniske tjenester',   'Professional and technical svc.', array['69','70','71','72','73','74','75'],     true,  30),
  ('industri',     'sn2007', 'Industri og produksjon',          'Manufacturing',                   array['10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','25','26','27','28','29','30','31','32','33'], false, 40),
  ('bygg',         'sn2007', 'Bygg og anlegg',                  'Construction',                    array['41','42','43'],                         false, 50),
  ('handel',       'sn2007', 'Handel og varehandel',            'Wholesale and retail',            array['45','46','47'],                         false, 60),
  ('transport',    'sn2007', 'Transport og lager',              'Transport and storage',           array['49','50','51','52','53'],               false, 70),
  ('overnatting',  'sn2007', 'Overnatting og servering',        'Accommodation and food svc.',     array['55','56'],                              false, 80),
  ('finans',       'sn2007', 'Finans og forsikring',            'Finance and insurance',           array['64','65','66'],                         false, 90),
  ('eiendom',      'sn2007', 'Eiendom',                         'Real estate',                     array['68'],                                   false, 100),
  ('helse',        'sn2007', 'Helse og omsorg',                 'Health and social work',          array['86','87','88'],                         false, 110),
  ('offentlig',    'sn2007', 'Offentlig sektor og utdanning',   'Public sector and education',     array['84','85'],                              false, 120),
  ('annet',        'sn2007', 'Annet / uklassifisert',           'Other / unclassified',            array[]::text[],                               false, 999)
on conflict (slug, taxonomy_version) do nothing;

-- Seed: SN2025-09 categories. The taxonomy was published 2025-09-01 by
-- SSB. Most 2-digit prefixes are unchanged from SN2007; we mirror the
-- same kibarometer-level groupings as a starting point and let the
-- operator refine via /admin/oppstart/categories without a deploy when
-- the SN2025-09 mappings get scrutinised.
insert into public.nace_categories (slug, taxonomy_version, label_no, label_en, code_prefixes, enrich_roles, sort_order) values
  ('it',           'sn2025-09', 'Informasjonsteknologi',           'Information technology',          array['62','63'],                              true,  10),
  ('kreativ-media','sn2025-09', 'Media og kreativ næring',         'Media and creative industries',   array['58','59','60','90','91','92','93'],     true,  20),
  ('tjenester',    'sn2025-09', 'Faglige og tekniske tjenester',   'Professional and technical svc.', array['69','70','71','72','73','74','75'],     true,  30),
  ('industri',     'sn2025-09', 'Industri og produksjon',          'Manufacturing',                   array['10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','25','26','27','28','29','30','31','32','33'], false, 40),
  ('bygg',         'sn2025-09', 'Bygg og anlegg',                  'Construction',                    array['41','42','43'],                         false, 50),
  ('handel',       'sn2025-09', 'Handel og varehandel',            'Wholesale and retail',            array['45','46','47'],                         false, 60),
  ('transport',    'sn2025-09', 'Transport og lager',              'Transport and storage',           array['49','50','51','52','53'],               false, 70),
  ('overnatting',  'sn2025-09', 'Overnatting og servering',        'Accommodation and food svc.',     array['55','56'],                              false, 80),
  ('finans',       'sn2025-09', 'Finans og forsikring',            'Finance and insurance',           array['64','65','66'],                         false, 90),
  ('eiendom',      'sn2025-09', 'Eiendom',                         'Real estate',                     array['68'],                                   false, 100),
  ('helse',        'sn2025-09', 'Helse og omsorg',                 'Health and social work',          array['86','87','88'],                         false, 110),
  ('offentlig',    'sn2025-09', 'Offentlig sektor og utdanning',   'Public sector and education',     array['84','85'],                              false, 120),
  ('annet',        'sn2025-09', 'Annet / uklassifisert',           'Other / unclassified',            array[]::text[],                               false, 999)
on conflict (slug, taxonomy_version) do nothing;

-- ============================================================
-- 2. kommune_fylke — 2-digit kommunenummer prefix -> fylke label.
--    Norway's kommunenummer is 4 digits where the first 2 = fylkesnummer.
--    Seeded with current (post-2024-reform) prefixes plus a few
--    historical-prefix mappings for pre-2018 entities surfaced by the
--    optional 2018-onwards bootstrap. Ambiguous reform-transition
--    prefixes (30, 38, 54) intentionally fall through to NULL — the
--    processor leaves brreg_companies.fylke null and the dashboard
--    bucket is "Ukjent".
-- ============================================================

create table if not exists public.kommune_fylke (
  prefix2 text primary key,
  fylke_label_no text not null,
  notes text
);

alter table public.kommune_fylke enable row level security;

drop policy if exists kommune_fylke_public_read on public.kommune_fylke;
create policy kommune_fylke_public_read on public.kommune_fylke
  for select using (true);

insert into public.kommune_fylke (prefix2, fylke_label_no, notes) values
  -- Current (post-2024-reform) fylker
  ('03', 'Oslo',              'Post-2024'),
  ('11', 'Rogaland',          'Post-2024'),
  ('15', 'Møre og Romsdal',   'Post-2024'),
  ('18', 'Nordland',          'Post-2024'),
  ('31', 'Østfold',           'Post-2024 (formerly part of Viken 30)'),
  ('32', 'Akershus',          'Post-2024 (formerly part of Viken 30)'),
  ('33', 'Buskerud',          'Post-2024 (formerly part of Viken 30)'),
  ('34', 'Innlandet',         'Post-2020 (Hedmark + Oppland)'),
  ('39', 'Vestfold',          'Post-2024 (formerly part of Vestfold og Telemark 38)'),
  ('40', 'Telemark',          'Post-2024 (formerly part of Vestfold og Telemark 38)'),
  ('42', 'Agder',             'Post-2020 (Aust-Agder + Vest-Agder)'),
  ('46', 'Vestland',          'Post-2020 (Hordaland + Sogn og Fjordane)'),
  ('50', 'Trøndelag',         'Post-2018 (Sør-Trøndelag + Nord-Trøndelag)'),
  ('55', 'Troms',             'Post-2024 (formerly part of Troms og Finnmark 54)'),
  ('56', 'Finnmark',          'Post-2024 (formerly part of Troms og Finnmark 54)'),
  -- Historical prefixes that resolve unambiguously to a current fylke
  ('01', 'Østfold',           'Pre-2020'),
  ('02', 'Akershus',          'Pre-2020'),
  ('04', 'Innlandet',         'Pre-2020 Hedmark'),
  ('05', 'Innlandet',         'Pre-2020 Oppland'),
  ('06', 'Buskerud',          'Pre-2020'),
  ('07', 'Vestfold',          'Pre-2020'),
  ('08', 'Telemark',          'Pre-2020'),
  ('09', 'Agder',             'Pre-2020 Aust-Agder'),
  ('10', 'Agder',             'Pre-2020 Vest-Agder'),
  ('12', 'Vestland',          'Pre-2020 Hordaland'),
  ('14', 'Vestland',          'Pre-2020 Sogn og Fjordane'),
  ('16', 'Trøndelag',         'Pre-2018 Sør-Trøndelag'),
  ('17', 'Trøndelag',         'Pre-2018 Nord-Trøndelag'),
  ('19', 'Troms',             'Pre-2020'),
  ('20', 'Finnmark',          'Pre-2020')
  -- 30 (Viken), 38 (Vestfold og Telemark), 54 (Troms og Finnmark)
  -- intentionally omitted — they map ambiguously across multiple current
  -- fylker; the processor treats them as null/Ukjent.
on conflict (prefix2) do nothing;

-- ============================================================
-- 3. brreg_companies — every company we've ingested. Bootstrap fills
--    history; daily cron appends. Never wiped. last_seen_at bumps on
--    re-ingest so we can detect rows that disappeared upstream.
-- ============================================================

create table if not exists public.brreg_companies (
  orgnr text primary key,
  navn text not null,
  organisasjonsform text,
  registrert_dato date,
  stiftelsesdato date,
  slettet_dato date,
  -- Industry codes (raw)
  naeringskode_1 text,
  naeringskode_2 text,
  naeringskode_3 text,
  naeringskode_taxonomy_version text check (naeringskode_taxonomy_version in ('sn2007', 'sn2025-09')),
  nace_category_slug text,
  -- Geography
  kommunenummer text,
  postnummer text,
  poststed text,
  fylke text,
  -- Size + capital
  antall_ansatte int,
  aksjekapital numeric(14,2),
  -- Free-text activity / formål
  aktivitet text,
  -- Lifecycle flags
  konkurs boolean not null default false,
  under_avvikling boolean not null default false,
  -- AI-relevance tagging
  has_ai_in_name boolean not null default false,
  has_ai_in_aktivitet boolean not null default false,
  is_ai_relevant boolean generated always as (has_ai_in_name or has_ai_in_aktivitet) stored,
  matched_keywords_name text[] not null default array[]::text[],
  matched_keywords_aktivitet text[] not null default array[]::text[],
  -- Role-fetch + founder-age (computed by the role pipeline)
  roles_fetched_at timestamptz,
  youngest_role_age_at_reg smallint,
  role_count smallint,
  -- Lifecycle
  ingested_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- Full source row from brreg, for re-derive when a column shape changes
  raw_jsonb jsonb
);

create index if not exists brreg_companies_registrert_dato_idx
  on public.brreg_companies (registrert_dato desc);

create index if not exists brreg_companies_nace_dato_idx
  on public.brreg_companies (nace_category_slug, registrert_dato desc);

create index if not exists brreg_companies_ai_relevant_idx
  on public.brreg_companies (registrert_dato desc)
  where is_ai_relevant;

create index if not exists brreg_companies_role_fetch_queue_idx
  on public.brreg_companies (orgnr)
  where roles_fetched_at is null;

create index if not exists brreg_companies_orgform_idx
  on public.brreg_companies (organisasjonsform)
  where is_ai_relevant;

alter table public.brreg_companies enable row level security;

-- Staff read for /admin/oppstart browsers. Public reads go through
-- the snapshot tables, never through the base table.
drop policy if exists brreg_companies_staff_read on public.brreg_companies;
create policy brreg_companies_staff_read on public.brreg_companies
  for select using (public.is_staff());

-- ============================================================
-- 4. brreg_roles — natural persons only. Juridical role-holders
--    (holding companies etc.) are filtered out at fetch time and
--    discarded; storing them adds noise without analytical value.
--    Personal data: NEVER public-readable; aggregated snapshots are.
-- ============================================================

create table if not exists public.brreg_roles (
  orgnr text not null references public.brreg_companies(orgnr) on delete cascade,
  role_code text not null,
  person_navn text not null,
  fodselsdato date not null,
  valid_from date,
  fetched_at timestamptz not null default now(),
  primary key (orgnr, role_code, person_navn, fodselsdato)
);

create index if not exists brreg_roles_orgnr_idx
  on public.brreg_roles (orgnr);

alter table public.brreg_roles enable row level security;

-- Staff-only read: this is the personal-data table. Aggregates that
-- count role-holders by age bucket are exposed via snapshot tables;
-- per-person data stays admin-only.
drop policy if exists brreg_roles_staff_read on public.brreg_roles;
create policy brreg_roles_staff_read on public.brreg_roles
  for select using (public.is_staff());

-- ============================================================
-- 5. brreg_url_queue — drives the role-fetch worker. Idempotent on
--    orgnr so re-enqueueing a company that already drained is a no-op.
-- ============================================================

create table if not exists public.brreg_url_queue (
  orgnr text primary key references public.brreg_companies(orgnr) on delete cascade,
  enqueued_at timestamptz not null default now(),
  attempts int not null default 0,
  last_error text,
  status text not null default 'pending'
    check (status in ('pending', 'fetched', 'failed'))
);

create index if not exists brreg_url_queue_pending_idx
  on public.brreg_url_queue (enqueued_at)
  where status = 'pending';

alter table public.brreg_url_queue enable row level security;

drop policy if exists brreg_url_queue_staff_read on public.brreg_url_queue;
create policy brreg_url_queue_staff_read on public.brreg_url_queue
  for select using (public.is_staff());

-- ============================================================
-- 6. Snapshot tables (recomputed nightly by refresh_all_brreg_snapshots).
--    Public-read RLS so the marketing /oppstart page can hit them via
--    the anon key without server-role routing. Mirror /jobbmarked's
--    pattern (truncate + insert).
-- ============================================================

create table if not exists public.brreg_snapshot_headline (
  computed_for date primary key,
  computed_at timestamptz not null,
  -- Volume
  total_7d int not null,
  total_30d int not null,
  total_30d_yoy int not null,
  -- AI relevance (name OR aktivitet)
  ai_relevant_count_30d int not null,
  ai_relevant_share_30d numeric(6,5) not null,
  -- Category mix (each is share of total_30d in [0,1])
  it_share_30d numeric(6,5) not null,
  kreativ_media_share_30d numeric(6,5) not null,
  tjenester_share_30d numeric(6,5) not null,
  enriched_combined_share_30d numeric(6,5) not null,
  -- Confidence: organisasjonsform mix among AI-relevant ventures
  -- (the single most telling "real money vs hype" indicator).
  -- Shares of ai_relevant_count_30d in [0,1].
  as_share_of_ai_relevant_30d numeric(6,5) not null,
  enk_share_of_ai_relevant_30d numeric(6,5) not null,
  -- Capital (NOK; null when no AS in the bucket)
  aksjekapital_median_ai_relevant_as_30d numeric(14,2),
  aksjekapital_median_non_ai_as_30d numeric(14,2),
  -- Acceleration: rate-of-change of AI-relevant registrations
  -- (current month vs prior month / current quarter vs prior quarter).
  -- Stored as a fraction in (-1, +inf); UI renders × 100.
  ai_relevant_mom_growth numeric,
  ai_relevant_qoq_growth numeric
);

create table if not exists public.brreg_snapshot_daily (
  registrert_dato date not null,
  nace_category_slug text not null,
  count int not null,
  ai_relevant_count int not null,
  young_founder_count int not null,
  primary key (registrert_dato, nace_category_slug)
);

create table if not exists public.brreg_snapshot_geography (
  fylke text primary key,
  count_30d int not null,
  ai_relevant_count_30d int not null,
  count_per_100k_30d numeric
);

create table if not exists public.brreg_snapshot_focus_daily (
  registrert_dato date not null,
  nace_category_slug text not null,
  total int not null,
  ai_relevant int not null,
  age_under_23 int not null,
  age_23_29 int not null,
  age_30_39 int not null,
  age_40_49 int not null,
  age_50_plus int not null,
  age_unknown int not null,
  primary key (registrert_dato, nace_category_slug)
);

create table if not exists public.brreg_snapshot_cohort (
  cohort_quarter date not null,
  is_ai_relevant boolean not null,
  total_at_registration int not null,
  still_active_count int not null,
  slettet_count int not null,
  konkurs_count int not null,
  survival_rate_pct numeric(5,2) not null,
  primary key (cohort_quarter, is_ai_relevant)
);

alter table public.brreg_snapshot_headline    enable row level security;
alter table public.brreg_snapshot_daily       enable row level security;
alter table public.brreg_snapshot_geography   enable row level security;
alter table public.brreg_snapshot_focus_daily enable row level security;
alter table public.brreg_snapshot_cohort      enable row level security;

drop policy if exists brreg_snapshot_headline_public_read    on public.brreg_snapshot_headline;
drop policy if exists brreg_snapshot_daily_public_read       on public.brreg_snapshot_daily;
drop policy if exists brreg_snapshot_geography_public_read   on public.brreg_snapshot_geography;
drop policy if exists brreg_snapshot_focus_daily_public_read on public.brreg_snapshot_focus_daily;
drop policy if exists brreg_snapshot_cohort_public_read      on public.brreg_snapshot_cohort;

create policy brreg_snapshot_headline_public_read    on public.brreg_snapshot_headline    for select using (true);
create policy brreg_snapshot_daily_public_read       on public.brreg_snapshot_daily       for select using (true);
create policy brreg_snapshot_geography_public_read   on public.brreg_snapshot_geography   for select using (true);
create policy brreg_snapshot_focus_daily_public_read on public.brreg_snapshot_focus_daily for select using (true);
create policy brreg_snapshot_cohort_public_read      on public.brreg_snapshot_cohort      for select using (true);

-- ============================================================
-- 7. Refresh functions (snapshot rebuilders). One transaction per call.
--    The orchestrator refresh_all_brreg_snapshots() is the public
--    entry point — it's what the cron handler hits via PostgREST /rpc.
-- ============================================================

create or replace function public.refresh_brreg_snapshot_daily() returns void
language plpgsql security definer set search_path = public as $$
declare
  young_max smallint;
begin
  select coalesce(brreg_young_founder_age_max, 22) into young_max from public.app_settings where id = 1;

  truncate table public.brreg_snapshot_daily;
  insert into public.brreg_snapshot_daily (registrert_dato, nace_category_slug, count, ai_relevant_count, young_founder_count)
  select
    registrert_dato,
    coalesce(nace_category_slug, 'annet'),
    count(*),
    count(*) filter (where is_ai_relevant),
    count(*) filter (where youngest_role_age_at_reg is not null and youngest_role_age_at_reg < young_max)
  from public.brreg_companies
  where registrert_dato is not null
  group by registrert_dato, coalesce(nace_category_slug, 'annet');
end;
$$;

create or replace function public.refresh_brreg_snapshot_geography() returns void
language plpgsql security definer set search_path = public as $$
begin
  truncate table public.brreg_snapshot_geography;
  -- count_per_100k_30d is left null in v1 (population data not yet
  -- imported). The dashboard renders raw counts when it's null.
  insert into public.brreg_snapshot_geography (fylke, count_30d, ai_relevant_count_30d, count_per_100k_30d)
  select
    fylke,
    count(*),
    count(*) filter (where is_ai_relevant),
    null
  from public.brreg_companies
  where fylke is not null
    and registrert_dato is not null
    and registrert_dato >= (current_date - interval '30 days')
  group by fylke;
end;
$$;

create or replace function public.refresh_brreg_snapshot_focus_daily() returns void
language plpgsql security definer set search_path = public as $$
declare
  young_max smallint;
begin
  select coalesce(brreg_young_founder_age_max, 22) into young_max from public.app_settings where id = 1;

  truncate table public.brreg_snapshot_focus_daily;
  -- Limited to enrich_roles=true categories, since founder-age only
  -- has data for those. Aggregates across both taxonomy versions of
  -- the same slug.
  insert into public.brreg_snapshot_focus_daily (
    registrert_dato, nace_category_slug, total, ai_relevant,
    age_under_23, age_23_29, age_30_39, age_40_49, age_50_plus, age_unknown
  )
  select
    c.registrert_dato,
    c.nace_category_slug,
    count(*),
    count(*) filter (where c.is_ai_relevant),
    count(*) filter (where c.youngest_role_age_at_reg < young_max),
    count(*) filter (where c.youngest_role_age_at_reg between young_max and 29),
    count(*) filter (where c.youngest_role_age_at_reg between 30 and 39),
    count(*) filter (where c.youngest_role_age_at_reg between 40 and 49),
    count(*) filter (where c.youngest_role_age_at_reg >= 50),
    count(*) filter (where c.youngest_role_age_at_reg is null)
  from public.brreg_companies c
  where c.registrert_dato is not null
    and c.nace_category_slug in (
      select distinct slug from public.nace_categories where enrich_roles
    )
  group by c.registrert_dato, c.nace_category_slug;
end;
$$;

create or replace function public.refresh_brreg_snapshot_cohort() returns void
language plpgsql security definer set search_path = public as $$
begin
  truncate table public.brreg_snapshot_cohort;
  -- One row per (cohort_quarter, is_ai_relevant). "Still active" =
  -- not slettet, not konkurs at refresh time. survival_rate_pct is
  -- a percentage 0-100 rounded to 2 decimals.
  insert into public.brreg_snapshot_cohort (
    cohort_quarter, is_ai_relevant,
    total_at_registration, still_active_count, slettet_count, konkurs_count,
    survival_rate_pct
  )
  select
    date_trunc('quarter', registrert_dato)::date as cohort_quarter,
    is_ai_relevant,
    count(*) as total_at_registration,
    count(*) filter (where slettet_dato is null and not konkurs) as still_active_count,
    count(*) filter (where slettet_dato is not null) as slettet_count,
    count(*) filter (where konkurs) as konkurs_count,
    case when count(*) = 0 then 0
         else round(
           (count(*) filter (where slettet_dato is null and not konkurs))::numeric
             / count(*) * 100, 2)
    end as survival_rate_pct
  from public.brreg_companies
  where registrert_dato is not null
  group by 1, 2;
end;
$$;

create or replace function public.refresh_brreg_snapshot_headline() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_total_7d int;
  v_total_30d int;
  v_total_30d_yoy int;
  v_ai_count_30d int;
  v_it_30d int;
  v_kreativ_30d int;
  v_tjenester_30d int;
  v_as_ai int;
  v_enk_ai int;
  v_median_ai_as numeric(14,2);
  v_median_non_ai_as numeric(14,2);
  v_ai_count_curr_month int;
  v_ai_count_prev_month int;
  v_ai_count_curr_q int;
  v_ai_count_prev_q int;
  v_mom numeric;
  v_qoq numeric;
begin
  -- Volume buckets
  select
    count(*) filter (where registrert_dato >= current_date - interval '7 days'),
    count(*) filter (where registrert_dato >= current_date - interval '30 days'),
    count(*) filter (where registrert_dato >= current_date - interval '395 days'
                       and registrert_dato <  current_date - interval '365 days'),
    count(*) filter (where is_ai_relevant
                       and registrert_dato >= current_date - interval '30 days'),
    count(*) filter (where nace_category_slug = 'it'
                       and registrert_dato >= current_date - interval '30 days'),
    count(*) filter (where nace_category_slug = 'kreativ-media'
                       and registrert_dato >= current_date - interval '30 days'),
    count(*) filter (where nace_category_slug = 'tjenester'
                       and registrert_dato >= current_date - interval '30 days'),
    count(*) filter (where is_ai_relevant
                       and organisasjonsform = 'AS'
                       and registrert_dato >= current_date - interval '30 days'),
    count(*) filter (where is_ai_relevant
                       and organisasjonsform = 'ENK'
                       and registrert_dato >= current_date - interval '30 days')
  into
    v_total_7d, v_total_30d, v_total_30d_yoy, v_ai_count_30d,
    v_it_30d, v_kreativ_30d, v_tjenester_30d,
    v_as_ai, v_enk_ai
  from public.brreg_companies;

  -- Median aksjekapital comparison (AS only)
  select percentile_cont(0.5) within group (order by aksjekapital)
    into v_median_ai_as
    from public.brreg_companies
    where organisasjonsform = 'AS'
      and is_ai_relevant
      and aksjekapital is not null
      and registrert_dato >= current_date - interval '30 days';

  select percentile_cont(0.5) within group (order by aksjekapital)
    into v_median_non_ai_as
    from public.brreg_companies
    where organisasjonsform = 'AS'
      and not is_ai_relevant
      and aksjekapital is not null
      and registrert_dato >= current_date - interval '30 days';

  -- Acceleration (MoM and QoQ growth of AI-relevant registrations)
  select
    count(*) filter (where is_ai_relevant
                       and registrert_dato >= date_trunc('month', current_date)::date),
    count(*) filter (where is_ai_relevant
                       and registrert_dato >= (date_trunc('month', current_date) - interval '1 month')::date
                       and registrert_dato <  date_trunc('month', current_date)::date),
    count(*) filter (where is_ai_relevant
                       and registrert_dato >= date_trunc('quarter', current_date)::date),
    count(*) filter (where is_ai_relevant
                       and registrert_dato >= (date_trunc('quarter', current_date) - interval '3 months')::date
                       and registrert_dato <  date_trunc('quarter', current_date)::date)
  into v_ai_count_curr_month, v_ai_count_prev_month, v_ai_count_curr_q, v_ai_count_prev_q
  from public.brreg_companies;

  v_mom := case when v_ai_count_prev_month = 0 then null
                else (v_ai_count_curr_month - v_ai_count_prev_month)::numeric / v_ai_count_prev_month
           end;
  v_qoq := case when v_ai_count_prev_q = 0 then null
                else (v_ai_count_curr_q - v_ai_count_prev_q)::numeric / v_ai_count_prev_q
           end;

  insert into public.brreg_snapshot_headline (
    computed_for, computed_at,
    total_7d, total_30d, total_30d_yoy,
    ai_relevant_count_30d, ai_relevant_share_30d,
    it_share_30d, kreativ_media_share_30d, tjenester_share_30d, enriched_combined_share_30d,
    as_share_of_ai_relevant_30d, enk_share_of_ai_relevant_30d,
    aksjekapital_median_ai_relevant_as_30d, aksjekapital_median_non_ai_as_30d,
    ai_relevant_mom_growth, ai_relevant_qoq_growth
  ) values (
    current_date, now(),
    v_total_7d, v_total_30d, v_total_30d_yoy,
    v_ai_count_30d,
    case when v_total_30d = 0 then 0 else round(v_ai_count_30d::numeric / v_total_30d, 5) end,
    case when v_total_30d = 0 then 0 else round(v_it_30d::numeric / v_total_30d, 5) end,
    case when v_total_30d = 0 then 0 else round(v_kreativ_30d::numeric / v_total_30d, 5) end,
    case when v_total_30d = 0 then 0 else round(v_tjenester_30d::numeric / v_total_30d, 5) end,
    case when v_total_30d = 0 then 0 else round((v_it_30d + v_kreativ_30d + v_tjenester_30d)::numeric / v_total_30d, 5) end,
    case when v_ai_count_30d = 0 then 0 else round(v_as_ai::numeric / v_ai_count_30d, 5) end,
    case when v_ai_count_30d = 0 then 0 else round(v_enk_ai::numeric / v_ai_count_30d, 5) end,
    v_median_ai_as,
    v_median_non_ai_as,
    v_mom,
    v_qoq
  )
  on conflict (computed_for) do update set
    computed_at                            = excluded.computed_at,
    total_7d                               = excluded.total_7d,
    total_30d                              = excluded.total_30d,
    total_30d_yoy                          = excluded.total_30d_yoy,
    ai_relevant_count_30d                  = excluded.ai_relevant_count_30d,
    ai_relevant_share_30d                  = excluded.ai_relevant_share_30d,
    it_share_30d                           = excluded.it_share_30d,
    kreativ_media_share_30d                = excluded.kreativ_media_share_30d,
    tjenester_share_30d                    = excluded.tjenester_share_30d,
    enriched_combined_share_30d            = excluded.enriched_combined_share_30d,
    as_share_of_ai_relevant_30d            = excluded.as_share_of_ai_relevant_30d,
    enk_share_of_ai_relevant_30d           = excluded.enk_share_of_ai_relevant_30d,
    aksjekapital_median_ai_relevant_as_30d = excluded.aksjekapital_median_ai_relevant_as_30d,
    aksjekapital_median_non_ai_as_30d      = excluded.aksjekapital_median_non_ai_as_30d,
    ai_relevant_mom_growth                 = excluded.ai_relevant_mom_growth,
    ai_relevant_qoq_growth                 = excluded.ai_relevant_qoq_growth;
end;
$$;

create or replace function public.refresh_all_brreg_snapshots() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_brreg_snapshot_daily();
  perform public.refresh_brreg_snapshot_geography();
  perform public.refresh_brreg_snapshot_focus_daily();
  perform public.refresh_brreg_snapshot_cohort();
  perform public.refresh_brreg_snapshot_headline();
end;
$$;

-- ============================================================
-- 8. app_settings extension. Three brreg-specific knobs:
--    - brreg_bootstrap_floor_date: how far back the bulk-dump bootstrap
--      pulls. Defaults to 2018-01-01 (6-year baseline for the "AI-named
--      share is N× the pre-2024 baseline" view).
--    - brreg_young_founder_age_max: cutoff for the "young founder"
--      bucket in segment 4. Defaults to 22 (i.e. <23).
--    - brreg_roles_retention_years: GDPR storage-limitation retention
--      window for personal data in brreg_roles. Defaults to 5 years
--      after company slettet_dato.
-- ============================================================

alter table public.app_settings
  add column if not exists brreg_bootstrap_floor_date date not null default date '2018-01-01';
alter table public.app_settings
  add column if not exists brreg_young_founder_age_max smallint not null default 22;
alter table public.app_settings
  add column if not exists brreg_roles_retention_years smallint not null default 5;

-- ============================================================
-- 9. Keyword seeds for company-name + aktivitet AI tagging. Reuses the
--    existing public.keywords table; the brreg processor will call
--    loadActiveKeywords (lib/admin/legacy/nav-processor.js:146) and
--    apply the same matchers twice per company. Only adds tokens that
--    aren't already in the seed from 0006_keywords.sql.
-- ============================================================

insert into public.keywords (term, language, category, match_type, notes) values
  ('agentic',     'any', 'concept', 'word',      'Agentic AI / agent frameworks. Common in 2024+ company naming.'),
  ('vibe',        'en',  'concept', 'word',      'Vibe-coding / vibe-coder. Risk: also generic mood word. Monitor FPs in NAV postings.'),
  ('embedding',   'en',  'concept', 'word',      'Vector embedding tooling.'),
  ('automation',  'en',  'concept', 'substring', 'Process automation / RPA. Broad term — catches AI-adjacent ventures.'),
  ('algoritme',   'no',  'concept', 'word',      'Norwegian for algorithm. Common in AI company names.'),
  ('chatbot',     'any', 'concept', 'word',      null),
  ('språkmodell-', 'no', 'concept', 'substring', 'Compound prefix; matches "språkmodellutvikling" etc.')
on conflict (term_norm, language) do nothing;
