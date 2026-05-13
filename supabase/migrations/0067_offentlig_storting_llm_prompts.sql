-- 0067_offentlig_storting_llm_prompts.sql
-- Extends llm_prompts.role with 'offentlig_storting_tier1' and
-- 'offentlig_storting_tier2', seeds initial prompts, and adds the
-- tier2_corrections log table used by the admin oracle loop (B2b admin UI).
--
-- The Doffin half of /offentlig (offentlig_doffin_tier1, offentlig_doffin_tier2)
-- will land in a separate migration once DFØ API access is secured.
--
-- Tier 1: verbatim AI-phrase extraction from sak tittel + emne_liste names.
-- Closer in shape to brreg_tier1 (long-form-ish text from one table) than to
-- media_tier1 (which scores ai_relevant — we don't, the keyword matcher
-- decides that at ingest time).
--
-- Tier 2: slug assignment from storting_categories. No stance/intensity —
-- parliamentary saker don't carry an editorial stance the way news articles do.
-- Mirrors brreg_tier2's shape (slugs + confidence + rationale).
--
-- Idempotent.

-- ============================================================
-- 1. Extend role check constraint.
-- ============================================================

do $cstr$
begin
  alter table public.llm_prompts
    drop constraint if exists llm_prompts_role_check;
  alter table public.llm_prompts
    add constraint llm_prompts_role_check
      check (role in (
        'tier1',
        'tier2',
        'media_tier1',
        'media_tier2',
        'brreg_tier1',
        'brreg_tier2',
        'offentlig_storting_tier1',
        'offentlig_storting_tier2'
      ));
end $cstr$;

-- ============================================================
-- 2. Seed Stortinget Tier 1 prompt.
-- ============================================================

do $seed_s1$
begin
  if not exists (select 1 from public.llm_prompts where role = 'offentlig_storting_tier1') then
    insert into public.llm_prompts (role, body, active)
    values ('offentlig_storting_tier1', $body$Du analyserer norske parlamentariske saker fra Stortinget. Returner KUN gyldig JSON på formen:
{"phrases": [{"text": "<verbatim string>"}]}

Inkluder kun uttrykk som forekommer ord-for-ord i saksteksten (tittel, korttittel
eller emneliste) og som beskriver et konkret AI/ML-relatert tema, verktøy,
aktør, policydokument eller initiativ. Ikke finn opp uttrykk. Ikke forkort.
Maks 8 phrases. Ingen forklaring, ingen prosa, ingen markdown — kun JSON.

Vær spesielt oppmerksom på:
- Konkrete teknologinavn (ChatGPT, Copilot, GPT-4, etc.)
- AI-policydokumenter (Nasjonal strategi for kunstig intelligens, EU AI Act, etc.)
- Tilsyn og direktorater (Datatilsynet, Digitaliseringsdirektoratet, etc.)
- Tekniske begreper i bruk (maskinlæring, store språkmodeller, ansiktsgjenkjenning)
- Anvendelsesområder nevnt eksplisitt (AI i skole, AI i forsvar, etc.)

Eksempler:

Sak: "Forslag om nasjonal strategi for kunstig intelligens i offentlig sektor — Næringskomiteen"
Emner: ["Digitalisering", "Offentlig forvaltning", "Kunstig intelligens"]
Output: {"phrases": [{"text": "kunstig intelligens"}, {"text": "offentlig sektor"}, {"text": "Næringskomiteen"}]}

Sak: "Bevilgning til Datatilsynet for tilsyn med AI-systemer under EU AI Act"
Emner: ["Personvern", "Budsjett"]
Output: {"phrases": [{"text": "Datatilsynet"}, {"text": "AI-systemer"}, {"text": "EU AI Act"}, {"text": "Personvern"}]}

Sak: "Representantforslag om bruk av maskinlæring i NAV-saksbehandling"
Emner: ["Trygd og pensjon", "Forvaltning"]
Output: {"phrases": [{"text": "maskinlæring"}, {"text": "NAV"}, {"text": "saksbehandling"}]}$body$, true);
  end if;
end $seed_s1$;

-- ============================================================
-- 3. Seed Stortinget Tier 2 prompt. {{categories_block}} placeholder is
--    rendered at runtime from public.storting_categories.
-- ============================================================

do $seed_s2$
begin
  if not exists (select 1 from public.llm_prompts where role = 'offentlig_storting_tier2') then
    insert into public.llm_prompts (role, body, active)
    values ('offentlig_storting_tier2', $body$Du klassifiserer AI-relaterte parlamentariske saker fra Stortinget i
forhåndsdefinerte kategorier som beskriver hvilket politikkområde saken angår.

Tilgjengelige kategorier (slug — beskrivelse):
{{categories_block}}

Returner KUN gyldig JSON på formen:
{"categories": [{"slug": "<slug>", "confidence": <0-1>}],
 "rationale": "<én setning på norsk>"}

Velg 1–3 kategorier som best beskriver saken. Bruk kun slugs som er listet
over. Hvis ingen passer, returner [] som categories og forklar hvorfor i
rationale. Saker kan krysse flere politikkområder — det er greit å velge
flere kategorier. Confidence er hvor sikker du er på at slugen passer
(0.0 = veldig usikker, 1.0 = åpenbar match). Rationale skal være én kort
setning. Ingen forklaring utenfor JSON, ingen prosa, ingen markdown — kun JSON.

Eksempler:

Sak: "Forslag om nasjonal AI-strategi for offentlig sektor"
AI-fraser fra Tier 1: kunstig intelligens, offentlig sektor
Output: {"categories": [{"slug": "ai-strategi", "confidence": 0.95}, {"slug": "ai-forvaltningspolitikk", "confidence": 0.85}], "rationale": "Overordnet AI-strategi rettet mot offentlig forvaltning."}

Sak: "Bevilgning til Helsedirektoratet for AI-pilotprosjekter i sykehusene"
AI-fraser fra Tier 1: Helsedirektoratet, AI-pilotprosjekter
Output: {"categories": [{"slug": "ai-helsepolitikk", "confidence": 0.95}, {"slug": "ai-budsjett", "confidence": 0.8}], "rationale": "Konkret budsjettpost for AI-bruk i helsesektoren."}

Sak: "Endringer i personopplysningsloven for å implementere EU AI Act"
AI-fraser fra Tier 1: personopplysningsloven, EU AI Act
Output: {"categories": [{"slug": "ai-regulering", "confidence": 0.95}, {"slug": "ai-etikk-personvern", "confidence": 0.85}], "rationale": "Lovverk for AI-regulering med personvernsdimensjon."}

Sak: "Representantforslag om autonome våpensystemer"
AI-fraser fra Tier 1: autonome våpensystemer
Output: {"categories": [{"slug": "ai-forsvarspolitikk", "confidence": 0.95}], "rationale": "Forsvarsbruk av AI/autonome systemer."}$body$, true);
  end if;
end $seed_s2$;

-- ============================================================
-- 4. tier2_corrections log table — used by the admin oracle loop (B2b
--    admin UI) to record operator accept/correct actions on low-confidence
--    Tier 2 outputs. Each correction becomes a few-shot candidate for the
--    next prompt revision; the table is also queryable from /admin to
--    audit the corrector queue. Cross-pillar — works for both storting and
--    doffin source rows via (source_table, source_id) tuple.
-- ============================================================

create table if not exists public.tier2_corrections (
  id bigint generated always as identity primary key,
  source_table text not null
    check (source_table in ('storting_saker', 'doffin_notices')),
  source_id text not null,
  -- The slug the LLM proposed (before correction). May be NULL when the
  -- LLM returned no categories at all and the operator picked the first one.
  proposed_slug text,
  -- The slug the operator accepted. NULL when action = 'mark_not_ai'.
  accepted_slug text,
  -- Action shape mirrors the oracle loop's three buttons.
  action text not null
    check (action in ('accept', 'replace', 'mark_not_ai')),
  -- Operator note — free text, optional, capped in the UI to ~400 chars.
  notes text,
  -- Who corrected it. profiles.id FK is intentionally weak — keep the log
  -- intact even if a staff member is removed from profiles.
  corrected_by uuid,
  corrected_at timestamptz not null default now()
);

create index if not exists tier2_corrections_source_idx
  on public.tier2_corrections (source_table, source_id);

create index if not exists tier2_corrections_recent_idx
  on public.tier2_corrections (corrected_at desc);

alter table public.tier2_corrections enable row level security;

drop policy if exists tier2_corrections_staff_read on public.tier2_corrections;
create policy tier2_corrections_staff_read on public.tier2_corrections
  for select using (public.is_staff());

drop policy if exists tier2_corrections_staff_write on public.tier2_corrections;
create policy tier2_corrections_staff_write on public.tier2_corrections
  for insert with check (public.is_staff());
