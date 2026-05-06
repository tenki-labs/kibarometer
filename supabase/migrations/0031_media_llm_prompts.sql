-- 0030_media_llm_prompts.sql
-- Extends the llm_prompts role-check constraint with 'media_tier1' and
-- 'media_tier2' and seeds the initial media prompts.
--
-- Tier 1: relevance confirmation + AI-phrase extraction (mirror of nav
-- 'tier1' but tuned for editorial Norwegian — articles vs. job ads).
-- Tier 2: classify into media taxonomy AND score stance + intensity.
-- The {{categories_block}} placeholder is replaced at runtime from
-- public.media_categories. The {{stance_block}} placeholder is fixed:
-- the 6-value stance enum is intentionally not operator-editable so
-- temperature time-series stay comparable across prompt revisions.
--
-- Idempotent. Safe to re-run.

do $cstr$
begin
  alter table public.llm_prompts
    drop constraint if exists llm_prompts_role_check;
  alter table public.llm_prompts
    add constraint llm_prompts_role_check
      check (role in ('tier1', 'tier2', 'media_tier1', 'media_tier2'));
end $cstr$;

-- Seed media Tier 1 prompt. Idempotent: only inserts if no row exists for
-- the role (operator edits via the UI survive subsequent re-runs).
do $seed_m1$
begin
  if not exists (select 1 from public.llm_prompts where role = 'media_tier1') then
    insert into public.llm_prompts (role, body, active)
    values ('media_tier1', $body$Du analyserer norske og engelske nyhetsartikler. Returner KUN gyldig JSON på formen:
{"ai_relevant": <bool>, "phrases": [{"text": "<verbatim string>"}]}

Inkluder bare uttrykk som forekommer ord-for-ord i artikkelen og som
beskriver et konkret AI/ML-relatert tema, verktøy, aktør eller hendelse.
Ikke finn opp uttrykk. Ikke forkort. Maks 8 phrases. Ingen forklaring,
ingen prosa, ingen markdown — kun JSON.

Eksempler:

Artikkel: "Datatilsynet advarer mot kommuners bruk av ChatGPT i saksbehandling. Direktøren mener risikoen for personvern er for høy."
Output: {"ai_relevant": true, "phrases": [{"text": "ChatGPT"}, {"text": "Datatilsynet"}, {"text": "personvern"}]}

Artikkel: "Brann i lagerbygg på Alnabru i natt. Ingen personer skadet."
Output: {"ai_relevant": false, "phrases": []}

Artikkel: "OpenAI lanserer ny språkmodell. Norske utviklere får tilgang via API i neste uke."
Output: {"ai_relevant": true, "phrases": [{"text": "OpenAI"}, {"text": "språkmodell"}, {"text": "API"}]}$body$, true);
  end if;
end $seed_m1$;

-- Seed media Tier 2 prompt. Stance enum is rendered inline (NOT a runtime
-- placeholder) — keeping stance values stable is critical for
-- time-series comparability of the Kibarometer Index.
do $seed_m2$
begin
  if not exists (select 1 from public.llm_prompts where role = 'media_tier2') then
    insert into public.llm_prompts (role, body, active)
    values ('media_tier2', $body$Du klassifiserer AI-relaterte nyhetsartikler i forhåndsdefinerte kategorier
og scorer artikkelens grunnleggende stance og intensitet.

Tilgjengelige kategorier (slug — beskrivelse):
{{categories_block}}

Stance må være nøyaktig én av disse seks verdiene:
- enthusiastic       — entusiastisk / hypende / positivt rammet
- alarmed            — bekymret / advarende / risikofokusert
- critical           — kritisk / problematiserende men ikke alarmistisk
- neutral-explainer  — nøytralt forklarende / faktasjekk / "hva er X"
- policy-debate      — politisk debatt / regulering / partsinnlegg
- personal-story     — personlig erfaring / portrett / case-historie

Intensity er hvor sterk artikkelens framing er, fra 0.0 (svakt) til 1.0 (sterkt).

Returner KUN gyldig JSON på formen:
{"categories": [{"slug": "<slug>", "confidence": <0-1>}],
 "stance": "<en av de seks>",
 "intensity": <0-1>,
 "rationale": "<én setning>"}

Velg 1–3 kategorier som best beskriver artikkelen. Bruk kun slugs som er
listet over. Hvis ingen passer, returner [] som categories. Rationale
skal være én kort setning på norsk eller engelsk. Ingen forklaring
utenfor JSON, ingen prosa, ingen markdown — kun JSON.

Eksempler:

Artikkel: "EU AI Act trer i kraft i Norge: bedrifter advarer om byråkrati."
Output: {"categories": [{"slug": "policy-regulation", "confidence": 0.95}], "stance": "alarmed", "intensity": 0.7, "rationale": "Compliance-byrde rammet som trussel mot norske bedrifter."}

Artikkel: "Ny rapport: ChatGPT bruker mindre energi enn antatt — forskere overrasket."
Output: {"categories": [{"slug": "technical-research", "confidence": 0.85}, {"slug": "infrastructure", "confidence": 0.6}], "stance": "neutral-explainer", "intensity": 0.4, "rationale": "Faktaorientert presentasjon av forskningsfunn."}

Artikkel: "OpenAI lanserer GPT-5 — kan revolusjonere programmering."
Output: {"categories": [{"slug": "tools-vendors", "confidence": 0.9}, {"slug": "technical-research", "confidence": 0.5}], "stance": "enthusiastic", "intensity": 0.8, "rationale": "Hypende framing av produktlansering."}

Artikkel: "Anna (34) mistet jobben til AI: 'Jeg så det ikke komme'."
Output: {"categories": [{"slug": "labour-impact", "confidence": 0.95}], "stance": "personal-story", "intensity": 0.7, "rationale": "Personlig portrett av automatiseringseffekt."}$body$, true);
  end if;
end $seed_m2$;
