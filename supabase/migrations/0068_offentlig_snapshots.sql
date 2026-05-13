-- 0068_offentlig_snapshots.sql
-- /offentlig pillar snapshot tables + refresh orchestrator. Lands the
-- full shape of every snapshot table the B3 public page will eventually
-- read, but only IMPLEMENTS and CALLS the refresh sub-functions that the
-- storting half of the pillar can populate today. The doffin sub-functions
-- (offentlig_snapshot_doffin_monthly, _governance_level, _buyer_anomaly,
-- and the doffin half of _headline / _resonance / _policy_lag) land in a
-- later migration once the doffin_notices base table exists. That
-- migration will CREATE OR REPLACE refresh_all_offentlig_snapshots() to
-- wire the new sub-functions in.
--
-- Snapshot tables follow the media/brreg precedent: public-read RLS so
-- the marketing /offentlig page reads them via the anon key without
-- server-role routing. Truncate-then-insert refresh per sub-function.
--
-- Idempotent.

-- ============================================================
-- 1. offentlig_snapshot_storting_monthly — AI debate volume per category
--    per calendar month. Powers the public DebateVolume + DebateCategories
--    sections. category_slug is one row per slug picked by Tier 2's
--    llm_categories assignment; saker with no Tier 2 result yet land
--    under a synthetic '__uncategorized' slug so the chart can render
--    "kategorisering pågår" without leaking the raw count.
-- ============================================================

create table if not exists public.offentlig_snapshot_storting_monthly (
  computed_for date not null,           -- month (1st of month)
  category_slug text not null,
  ai_count int not null,
  primary key (computed_for, category_slug)
);

alter table public.offentlig_snapshot_storting_monthly enable row level security;

drop policy if exists offentlig_snapshot_storting_monthly_public_read
  on public.offentlig_snapshot_storting_monthly;
create policy offentlig_snapshot_storting_monthly_public_read
  on public.offentlig_snapshot_storting_monthly
  for select using (true);

-- ============================================================
-- 2. offentlig_snapshot_doffin_monthly — AI spend per category per
--    buyer-level per month. Populated by a future doffin migration; the
--    table is defined here so the schema is stable for B3 consumers.
-- ============================================================

create table if not exists public.offentlig_snapshot_doffin_monthly (
  computed_for date not null,
  category_slug text not null,
  buyer_level text not null
    check (buyer_level in ('staten', 'kommune', 'fylke', 'public_undertaking', 'ukjent')),
  ai_count int not null default 0,
  ai_value_nok numeric(18,2) not null default 0,
  primary key (computed_for, category_slug, buyer_level)
);

alter table public.offentlig_snapshot_doffin_monthly enable row level security;

drop policy if exists offentlig_snapshot_doffin_monthly_public_read
  on public.offentlig_snapshot_doffin_monthly;
create policy offentlig_snapshot_doffin_monthly_public_read
  on public.offentlig_snapshot_doffin_monthly
  for select using (true);

-- ============================================================
-- 3. offentlig_snapshot_governance_level — bottom-up vs top-down stacked
--    area for the public page. Aggregates doffin contract value across
--    buyer levels. doffin-only.
-- ============================================================

create table if not exists public.offentlig_snapshot_governance_level (
  computed_for date not null,
  buyer_level text not null
    check (buyer_level in ('staten', 'kommune', 'fylke', 'public_undertaking', 'ukjent')),
  ai_value_nok numeric(18,2) not null default 0,
  total_value_nok numeric(18,2) not null default 0,
  primary key (computed_for, buyer_level)
);

alter table public.offentlig_snapshot_governance_level enable row level security;

drop policy if exists offentlig_snapshot_governance_level_public_read
  on public.offentlig_snapshot_governance_level;
create policy offentlig_snapshot_governance_level_public_read
  on public.offentlig_snapshot_governance_level
  for select using (true);

-- ============================================================
-- 4. offentlig_snapshot_resonance — 3-axis chart: news (from
--    media_snapshot_daily), storting (from this pillar), doffin (from
--    this pillar). Each axis normalized to its own [0,1] peak over the
--    backfill horizon so the three lines are comparable on the same axis.
--    Populated for the storting axis in this migration; news + doffin
--    axes land as part of refresh_all_offentlig_snapshots once doffin is
--    online (news axis reads existing media_snapshot_daily directly).
-- ============================================================

create table if not exists public.offentlig_snapshot_resonance (
  computed_for date not null primary key,    -- month
  news_norm real,                            -- nullable until media join wired
  storting_norm real,
  doffin_norm real
);

alter table public.offentlig_snapshot_resonance enable row level security;

drop policy if exists offentlig_snapshot_resonance_public_read
  on public.offentlig_snapshot_resonance;
create policy offentlig_snapshot_resonance_public_read
  on public.offentlig_snapshot_resonance
  for select using (true);

-- ============================================================
-- 5. offentlig_snapshot_policy_lag — median days between a Stortinget
--    sak (vedtak) and the first downstream Doffin notice in a mapped
--    category. Needs both sources; refresh sub-function lands with
--    the doffin migration.
-- ============================================================

create table if not exists public.offentlig_snapshot_policy_lag (
  storting_category_slug text not null,
  doffin_category_slug text not null,
  median_lag_days int,
  sample_size int not null default 0,
  computed_for_period daterange,
  primary key (storting_category_slug, doffin_category_slug)
);

alter table public.offentlig_snapshot_policy_lag enable row level security;

drop policy if exists offentlig_snapshot_policy_lag_public_read
  on public.offentlig_snapshot_policy_lag;
create policy offentlig_snapshot_policy_lag_public_read
  on public.offentlig_snapshot_policy_lag
  for select using (true);

-- ============================================================
-- 6. offentlig_snapshot_buyer_anomaly — "surprising procurement" feed.
--    Per AI-flagged notice, the Jaccard distance between its CPV codes
--    and the buyer's own recent CPV history. Top 50 highest distances
--    surface on the public page. Doffin-only; refresh sub-function
--    lands with the doffin migration.
-- ============================================================

create table if not exists public.offentlig_snapshot_buyer_anomaly (
  buyer_orgnr text not null,
  notice_id text not null,
  jaccard_distance real not null,
  baseline_cpv_codes text[] not null default array[]::text[],
  baseline_window daterange,
  computed_at timestamptz not null default now(),
  primary key (buyer_orgnr, notice_id)
);

create index if not exists offentlig_snapshot_buyer_anomaly_recent_idx
  on public.offentlig_snapshot_buyer_anomaly (jaccard_distance desc, computed_at desc);

alter table public.offentlig_snapshot_buyer_anomaly enable row level security;

drop policy if exists offentlig_snapshot_buyer_anomaly_public_read
  on public.offentlig_snapshot_buyer_anomaly;
create policy offentlig_snapshot_buyer_anomaly_public_read
  on public.offentlig_snapshot_buyer_anomaly
  for select using (true);

-- ============================================================
-- 7. offentlig_snapshot_headline — single-row summary for the public
--    PillarHero. Doffin-related columns (NOK totals, top vendor / buyer,
--    kommune share, spend_yoy_pct) stay NULL until the doffin half is
--    online; the public hero renders "Snart tilgjengelig" placeholders
--    where it sees NULL.
-- ============================================================

create table if not exists public.offentlig_snapshot_headline (
  computed_for date primary key,
  computed_at timestamptz not null,

  -- Stortinget side (populated in this migration)
  total_saker_ai bigint,
  total_saker_ai_12m bigint,           -- trailing 12 months
  total_saker_ai_prior_12m bigint,     -- 12 months before that
  debate_yoy_pct numeric(8,2),         -- (curr - prior) / prior * 100, nullable when prior=0
  top_komite_navn text,
  top_komite_count int,

  -- Doffin side (populated in a future migration)
  total_notices_ai bigint,
  total_nok_ai numeric(18,2),
  total_nok_ai_12m numeric(18,2),
  total_nok_ai_prior_12m numeric(18,2),
  spend_yoy_pct numeric(8,2),
  kommune_share_pct numeric(8,2),
  top_buyer_agency text,
  top_vendor_navn text,
  top_vendor_orgnr text
);

alter table public.offentlig_snapshot_headline enable row level security;

drop policy if exists offentlig_snapshot_headline_public_read
  on public.offentlig_snapshot_headline;
create policy offentlig_snapshot_headline_public_read
  on public.offentlig_snapshot_headline
  for select using (true);

-- ============================================================
-- 8. Refresh sub-functions — STORTING ONLY for now. Each sub-function
--    truncates its table then re-inserts. Wrapped by the orchestrator
--    below so the public page sees a consistent set of snapshot rows.
-- ============================================================

-- Storting monthly volume per category. category_slug comes from the Tier 2
-- llm_categories JSONB. Rows with no Tier 2 result land in '__uncategorized'
-- so the public page can render "kategorisering pågår" without a bespoke
-- count query.
create or replace function public.refresh_offentlig_snapshot_storting_monthly()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  truncate public.offentlig_snapshot_storting_monthly;

  -- Categorized: one row per (month, category_slug) emitted by Tier 2.
  insert into public.offentlig_snapshot_storting_monthly
    (computed_for, category_slug, ai_count)
  select
    date_trunc('month', s.sist_oppdatert_dato)::date as computed_for,
    elem->>'slug'                                     as category_slug,
    count(*)                                          as ai_count
  from public.storting_saker s
  cross join lateral jsonb_array_elements(
    coalesce(s.llm_categories->'categories', '[]'::jsonb)
  ) as elem
  where s.is_ai_relevant
    and s.sist_oppdatert_dato is not null
    and s.tier2_completed_at is not null
    and elem->>'slug' is not null
  group by 1, 2;

  -- Uncategorized: AI-flagged saker that haven't gone through Tier 2 yet.
  -- One synthetic slug so the chart axis stays stable.
  insert into public.offentlig_snapshot_storting_monthly
    (computed_for, category_slug, ai_count)
  select
    date_trunc('month', s.sist_oppdatert_dato)::date,
    '__uncategorized',
    count(*)
  from public.storting_saker s
  where s.is_ai_relevant
    and s.sist_oppdatert_dato is not null
    and s.tier2_completed_at is null
  group by 1
  on conflict (computed_for, category_slug) do nothing;
end;
$$;

-- Resonance: storting axis only for now. The orchestrator wires this row
-- in; news_norm + doffin_norm stay NULL until those sources land.
--
-- Normalization: divide each month's count by the all-time max so the
-- series sits in [0, 1]. When new highs come in, older rows shrink — the
-- chart relabels axis ticks dynamically (B3 work).
create or replace function public.refresh_offentlig_snapshot_resonance_storting()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_peak numeric;
begin
  -- Storting axis comes from the monthly snapshot we just rebuilt.
  -- We do NOT truncate here — the orchestrator owns the truncate, since
  -- multiple sub-functions write to this table (news, storting, doffin).
  select max(monthly_ai)
    into v_peak
  from (
    select sum(ai_count) as monthly_ai
    from public.offentlig_snapshot_storting_monthly
    where category_slug <> '__uncategorized'
    group by computed_for
  ) m;

  if v_peak is null or v_peak = 0 then
    return; -- no AI-flagged rows yet; skip
  end if;

  insert into public.offentlig_snapshot_resonance (computed_for, storting_norm)
  select
    computed_for,
    (sum(ai_count)::real / v_peak::real) as storting_norm
  from public.offentlig_snapshot_storting_monthly
  where category_slug <> '__uncategorized'
  group by computed_for
  on conflict (computed_for) do update
    set storting_norm = excluded.storting_norm;
end;
$$;

-- Headline: single-row summary, storting side. Doffin side stays NULL.
create or replace function public.refresh_offentlig_snapshot_headline()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := current_date;
  v_12m_ago date := current_date - interval '12 months';
  v_24m_ago date := current_date - interval '24 months';
  v_curr_total bigint;
  v_prior_total bigint;
  v_yoy numeric(8,2);
  v_top_komite_navn text;
  v_top_komite_count int;
  v_total_ai bigint;
begin
  -- Total AI-flagged saker, all time
  select count(*) into v_total_ai
    from public.storting_saker
    where is_ai_relevant;

  -- Trailing 12-month vs prior 12-month counts (for YoY)
  select count(*) into v_curr_total
    from public.storting_saker
    where is_ai_relevant
      and sist_oppdatert_dato >= v_12m_ago
      and sist_oppdatert_dato < v_today;

  select count(*) into v_prior_total
    from public.storting_saker
    where is_ai_relevant
      and sist_oppdatert_dato >= v_24m_ago
      and sist_oppdatert_dato < v_12m_ago;

  v_yoy := case
    when v_prior_total is null or v_prior_total = 0 then null
    else round(((v_curr_total - v_prior_total)::numeric / v_prior_total::numeric) * 100, 2)
  end;

  -- Top komité by AI-flagged sak count (last 24 months for relevance)
  select komite_navn, count(*)
    into v_top_komite_navn, v_top_komite_count
    from public.storting_saker
    where is_ai_relevant
      and komite_navn is not null
      and sist_oppdatert_dato >= v_24m_ago
    group by komite_navn
    order by count(*) desc, komite_navn asc
    limit 1;

  -- Truncate + insert (single row, PK on computed_for=today)
  delete from public.offentlig_snapshot_headline where computed_for = v_today;
  insert into public.offentlig_snapshot_headline
    (computed_for, computed_at,
     total_saker_ai, total_saker_ai_12m, total_saker_ai_prior_12m, debate_yoy_pct,
     top_komite_navn, top_komite_count)
  values
    (v_today, now(),
     v_total_ai, coalesce(v_curr_total, 0), coalesce(v_prior_total, 0), v_yoy,
     v_top_komite_navn, v_top_komite_count);
end;
$$;

-- ============================================================
-- 9. Orchestrator. Sequenced so dependencies (e.g. resonance reads
--    storting_monthly) run in the right order. The doffin sub-functions
--    will get added by a future migration via CREATE OR REPLACE on this
--    function — order to be: storting → doffin → resonance (joins both)
--    → policy_lag (joins both) → headline (joins both) → governance →
--    buyer_anomaly.
-- ============================================================

create or replace function public.refresh_all_offentlig_snapshots()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Per-source rebuilds first
  perform public.refresh_offentlig_snapshot_storting_monthly();

  -- Cross-pillar / derived (storting-only axes for now)
  truncate public.offentlig_snapshot_resonance;
  perform public.refresh_offentlig_snapshot_resonance_storting();

  -- Single-row summary last
  perform public.refresh_offentlig_snapshot_headline();
end;
$$;
