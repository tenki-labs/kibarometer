-- 0018_llm_prompts.sql
-- Versioned LLM system prompts. Both Tier 1 (discovery) and Tier 2
-- (classification) read the active prompt from this table at runtime so
-- operators can edit them via /admin/llm-prompts (PR 8) without a redeploy.
--
-- Each save creates a new row (immutable history); a partial unique index
-- enforces "one active prompt per role". Set-active is a transactional
-- toggle that updates two rows.
--
-- Tier 2's body contains the {{categories_block}} placeholder, replaced at
-- runtime by lib/admin/llm-classify.ts with the active taxonomy from 0017.
--
-- Idempotent.

create table if not exists public.llm_prompts (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('tier1', 'tier2')),
  body text not null,
  examples jsonb,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  created_by text
);

-- One active prompt per role. Partial unique index — multiple inactive
-- rows per role are fine (the version history).
create unique index if not exists llm_prompts_one_active_per_role
  on public.llm_prompts (role) where active;

create index if not exists llm_prompts_role_created_idx
  on public.llm_prompts (role, created_at desc);

alter table public.llm_prompts enable row level security;

drop policy if exists llm_prompts_staff_read on public.llm_prompts;
create policy llm_prompts_staff_read on public.llm_prompts
  for select using (public.is_staff());

drop policy if exists llm_prompts_admin_write on public.llm_prompts;
create policy llm_prompts_admin_write on public.llm_prompts
  for all using (public.is_admin_or_super())
  with check (public.is_admin_or_super());

-- Seed Tier 1 prompt. Idempotent: only inserts if there's no row at all
-- for the role, so operator edits via the UI survive subsequent re-runs.
do $seed_tier1$
begin
  if not exists (select 1 from public.llm_prompts where role = 'tier1') then
    insert into public.llm_prompts (role, body, active)
    values ('tier1', $tier1_body$Du analyserer norske og engelske jobbannonser. Returner KUN gyldig JSON på formen:
{"ai_relevant": <bool>, "phrases": [{"text": "<verbatim string>"}]}

Inkluder bare uttrykk som forekommer ord-for-ord i annonsen og som beskriver
en konkret AI/ML-relatert ferdighet, verktøy, rolle eller praksis. Ikke finn
opp uttrykk. Ikke forkort. Maks 8 phrases. Ingen forklaring, ingen prosa,
ingen markdown — kun JSON.

Eksempler:

Annonse: "Vi søker en Maskinlæringsingeniør med erfaring i PyTorch og MLOps."
Output: {"ai_relevant": true, "phrases": [{"text": "Maskinlæringsingeniør"}, {"text": "PyTorch"}, {"text": "MLOps"}]}

Annonse: "Sykepleier til hjemmebasert tjeneste."
Output: {"ai_relevant": false, "phrases": []}

Annonse: "Søker Data Scientist for å bygge LLM-basert kundeservice-automasjon."
Output: {"ai_relevant": true, "phrases": [{"text": "Data Scientist"}, {"text": "LLM"}]}$tier1_body$, true);
  end if;
end $seed_tier1$;

-- Seed Tier 2 prompt. {{categories_block}} is replaced at runtime by the
-- live taxonomy. Same idempotency guard as Tier 1.
do $seed_tier2$
begin
  if not exists (select 1 from public.llm_prompts where role = 'tier2') then
    insert into public.llm_prompts (role, body, active)
    values ('tier2', $tier2_body$Du klassifiserer AI-relaterte jobbannonser i forhåndsdefinerte kategorier.

Tilgjengelige kategorier (slug — beskrivelse):
{{categories_block}}

Returner KUN gyldig JSON på formen:
{"categories": [{"slug": "<slug>", "confidence": <0-1>}], "rationale": "<én setning>"}

Velg 1–3 kategorier som best beskriver stillingen. confidence = hvor sikker du er (0–1).
Bruk kun slugs som er listet over. Hvis ingen passer, returner [] som categories.
Rationale skal være én kort setning på norsk eller engelsk.
Ingen forklaring utenfor JSON, ingen prosa, ingen markdown — kun JSON.

Eksempler:

Annonse: "Vi søker en Prompt Engineer for å optimalisere våre LLM-prompts og evalueringspipeline. Du jobber tett med produktteamet for å iterere på instruksjonsdesign."
Output: {"categories": [{"slug": "prompt-engineering", "confidence": 0.95}], "rationale": "Stillingen handler primært om å designe og forbedre LLM-prompts."}

Annonse: "Data Scientist med erfaring i prediksjon, statistisk modellering og A/B-testing for å forbedre vår kundeoppslagstjeneste."
Output: {"categories": [{"slug": "ml-data-science", "confidence": 0.9}], "rationale": "Klassisk data science-rolle med statistisk modellering."}

Annonse: "Bygg autonome AI-agenter med LangChain og verktøykall. Søker erfaring med multi-step reasoning og RAG-pipelines."
Output: {"categories": [{"slug": "ai-agent-builder", "confidence": 0.92}], "rationale": "Eksplisitt agent-bygging med LangChain og RAG."}

Annonse: "MLOps Engineer for å bygge skalerbar produksjonsinfrastruktur for ML-modeller — Kubernetes, modell-serving, monitoring."
Output: {"categories": [{"slug": "ml-engineering-mlops", "confidence": 0.95}], "rationale": "MLOps-orientert: produksjonsinfrastruktur og skalering."}

Annonse: "Senior fullstack-utvikler for å integrere LLM-funksjoner i vårt CRM. Kjennskap til OpenAI API en fordel."
Output: {"categories": [{"slug": "applied-ai-software", "confidence": 0.85}], "rationale": "Applied software med AI-integrering, ikke primært ML."}

Annonse: "Vi søker en data scientist som også skal bygge LLM-baserte autonome agenter for kundeservice."
Output: {"categories": [{"slug": "ml-data-science", "confidence": 0.6}, {"slug": "ai-agent-builder", "confidence": 0.7}], "rationale": "Hybrid rolle med data science og agent-bygging."}$tier2_body$, true);
  end if;
end $seed_tier2$;
