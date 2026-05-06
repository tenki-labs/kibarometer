-- 0039_brreg_llm_prompts.sql
-- Extends the llm_prompts role-check constraint with 'brreg_tier1' and
-- 'brreg_tier2' and seeds the initial brreg prompts.
--
-- Tier 1: relevance confirmation + AI-phrase extraction. Mirrors
-- media_tier1 but tuned for brreg-aktivitet text — usually short,
-- formal, NACE-style descriptions of company purpose.
--
-- Tier 2: classify into brreg_categories slugs. Unlike media_tier2
-- there is NO stance/intensity scoring — companies don't have an
-- editorial stance. Closer to NAV's tier2 in shape (slug + confidence
-- + rationale) than to media_tier2.
--
-- Idempotent. Safe to re-run.

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
        'brreg_tier2'
      ));
end $cstr$;

-- Seed brreg Tier 1 prompt. Idempotent: only inserts if no row exists for
-- the role (operator edits via the UI survive subsequent re-runs).
do $seed_b1$
begin
  if not exists (select 1 from public.llm_prompts where role = 'brreg_tier1') then
    insert into public.llm_prompts (role, body, active)
    values ('brreg_tier1', $body$Du analyserer norske selskaps-aktivitetsbeskrivelser fra Brønnøysundregistrene. Returner KUN gyldig JSON på formen:
{"ai_relevant": <bool>, "phrases": [{"text": "<verbatim string>"}]}

Inkluder bare uttrykk som forekommer ord-for-ord i aktivitetsteksten og som
beskriver et konkret AI/ML-relatert tema, verktøy, marked eller praksis.
Ikke finn opp uttrykk. Ikke forkort. Maks 5 phrases — aktivitet-tekster
er korte. Ingen forklaring, ingen prosa, ingen markdown — kun JSON.

Eksempler:

Aktivitet: "Utvikling og salg av maskinlæringsbaserte løsninger for medisinsk bildediagnostikk."
Output: {"ai_relevant": true, "phrases": [{"text": "maskinlæringsbaserte løsninger"}, {"text": "medisinsk bildediagnostikk"}]}

Aktivitet: "Drift av frisørsalong."
Output: {"ai_relevant": false, "phrases": []}

Aktivitet: "Konsulenttjenester innen kunstig intelligens og dataanalyse for offentlig sektor."
Output: {"ai_relevant": true, "phrases": [{"text": "kunstig intelligens"}, {"text": "dataanalyse"}, {"text": "offentlig sektor"}]}$body$, true);
  end if;
end $seed_b1$;

-- Seed brreg Tier 2 prompt. {{categories_block}} substituted at runtime
-- from public.brreg_categories. Same idempotency guard.
do $seed_b2$
begin
  if not exists (select 1 from public.llm_prompts where role = 'brreg_tier2') then
    insert into public.llm_prompts (role, body, active)
    values ('brreg_tier2', $body$Du klassifiserer norske AI-relaterte selskaper basert på deres
aktivitetsbeskrivelse fra Brønnøysundregistrene.

Tilgjengelige kategorier (slug — beskrivelse):
{{categories_block}}

Returner KUN gyldig JSON på formen:
{"categories": [{"slug": "<slug>", "confidence": <0-1>}], "rationale": "<én setning>"}

Velg 1–3 kategorier som best beskriver selskapet. confidence = hvor sikker
du er (0–1). Bruk kun slugs som er listet over. Hvis ingen passer, returner
[] som categories. Rationale skal være én kort setning på norsk eller
engelsk. Ingen forklaring utenfor JSON, ingen prosa, ingen markdown — kun
JSON.

Eksempler:

Aktivitet: "Utvikling av AI-drevet kodegjennomgang og pull request-analyse for utviklerteam."
Output: {"categories": [{"slug": "developer-tools", "confidence": 0.95}], "rationale": "Verktøy for utviklere som bruker AI som kjerne-funksjon."}

Aktivitet: "Maskinlæringsplattform for medisinsk diagnostikk og pasientjournaler."
Output: {"categories": [{"slug": "vertical-saas", "confidence": 0.9}], "rationale": "Bransjespesifikk SaaS for helse med AI som hovedfunksjon."}

Aktivitet: "Utleie av GPU-kapasitet og skalerbar modell-serving til AI-bedrifter."
Output: {"categories": [{"slug": "infrastructure", "confidence": 0.95}], "rationale": "Lavnivå AI-infrastruktur — GPU og modell-serving."}$body$, true);
  end if;
end $seed_b2$;
