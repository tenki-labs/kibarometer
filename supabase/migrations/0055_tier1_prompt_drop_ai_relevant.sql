-- 0055_tier1_prompt_drop_ai_relevant.sql
--
-- Aligns the Tier 1 LLM prompts with the keyword-driven AI-relevance design.
-- Previously the prompts asked for `ai_relevant: <bool>` in the JSON
-- response, but that field has never been load-bearing — `is_ai*` columns
-- are written by the keyword matcher at ingest, never by an LLM. Tier 1
-- only extracts verbatim AI-phrases for keyword-catalog growth.
--
-- This migration overwrites the seeded prompt body with a version that no
-- longer asks for `ai_relevant`. The orchestrators
-- (lib/admin/llm-discover.ts, llm-media-tier1.ts, llm-brreg-tier1.ts) and
-- the shared parser (llm-media-parse.ts) ignore the legacy field if a
-- mid-rollout LLM still emits it, so this can land independently of the
-- code change.
--
-- Idempotent. Each update is guarded by `body like '%"ai_relevant"%'` so
-- re-running after the prompt has been corrected is a no-op. Operator
-- edits made via /admin/{job-market,media,startups}/prompts that no
-- longer contain "ai_relevant" are preserved.

-- NAV Tier 1 (jobbmarked)
update public.llm_prompts
   set body = $body$Du analyserer norske og engelske jobbannonser. Returner KUN gyldig JSON på formen:
{"phrases": [{"text": "<verbatim string>"}]}

Inkluder bare uttrykk som forekommer ord-for-ord i annonsen og som beskriver
en konkret AI/ML-relatert ferdighet, verktøy, rolle eller praksis. Ikke finn
opp uttrykk. Ikke forkort. Maks 8 phrases. Ingen forklaring, ingen prosa,
ingen markdown — kun JSON. Hvis ingen AI-relaterte uttrykk finnes, returner
{"phrases": []}.

Eksempler:

Annonse: "Vi søker en Maskinlæringsingeniør med erfaring i PyTorch og MLOps."
Output: {"phrases": [{"text": "Maskinlæringsingeniør"}, {"text": "PyTorch"}, {"text": "MLOps"}]}

Annonse: "Sykepleier til hjemmebasert tjeneste."
Output: {"phrases": []}

Annonse: "Søker Data Scientist for å bygge LLM-basert kundeservice-automasjon."
Output: {"phrases": [{"text": "Data Scientist"}, {"text": "LLM"}]}$body$
 where role = 'tier1'
   and active = true
   and body like '%"ai_relevant"%';

-- Media Tier 1
update public.llm_prompts
   set body = $body$Du analyserer norske og engelske nyhetsartikler. Returner KUN gyldig JSON på formen:
{"phrases": [{"text": "<verbatim string>"}]}

Inkluder bare uttrykk som forekommer ord-for-ord i artikkelen og som
beskriver et konkret AI/ML-relatert tema, verktøy, aktør eller hendelse.
Ikke finn opp uttrykk. Ikke forkort. Maks 8 phrases. Ingen forklaring,
ingen prosa, ingen markdown — kun JSON. Hvis ingen AI-relaterte uttrykk
finnes, returner {"phrases": []}.

Eksempler:

Artikkel: "Datatilsynet advarer mot kommuners bruk av ChatGPT i saksbehandling. Direktøren mener risikoen for personvern er for høy."
Output: {"phrases": [{"text": "ChatGPT"}, {"text": "Datatilsynet"}, {"text": "personvern"}]}

Artikkel: "Brann i lagerbygg på Alnabru i natt. Ingen personer skadet."
Output: {"phrases": []}

Artikkel: "OpenAI lanserer ny språkmodell. Norske utviklere får tilgang via API i neste uke."
Output: {"phrases": [{"text": "OpenAI"}, {"text": "språkmodell"}, {"text": "API"}]}$body$
 where role = 'media_tier1'
   and active = true
   and body like '%"ai_relevant"%';

-- BRREG Tier 1
update public.llm_prompts
   set body = $body$Du analyserer norske selskaps-aktivitetsbeskrivelser fra Brønnøysundregistrene. Returner KUN gyldig JSON på formen:
{"phrases": [{"text": "<verbatim string>"}]}

Inkluder bare uttrykk som forekommer ord-for-ord i aktivitetsteksten og som
beskriver et konkret AI/ML-relatert tema, verktøy, marked eller praksis.
Ikke finn opp uttrykk. Ikke forkort. Maks 5 phrases — aktivitet-tekster
er korte. Ingen forklaring, ingen prosa, ingen markdown — kun JSON. Hvis
ingen AI-relaterte uttrykk finnes, returner {"phrases": []}.

Eksempler:

Aktivitet: "Utvikling og salg av maskinlæringsbaserte løsninger for medisinsk bildediagnostikk."
Output: {"phrases": [{"text": "maskinlæringsbaserte løsninger"}, {"text": "medisinsk bildediagnostikk"}]}

Aktivitet: "Drift av frisørsalong."
Output: {"phrases": []}

Aktivitet: "Konsulenttjenester innen kunstig intelligens og dataanalyse for offentlig sektor."
Output: {"phrases": [{"text": "kunstig intelligens"}, {"text": "dataanalyse"}, {"text": "offentlig sektor"}]}$body$
 where role = 'brreg_tier1'
   and active = true
   and body like '%"ai_relevant"%';
