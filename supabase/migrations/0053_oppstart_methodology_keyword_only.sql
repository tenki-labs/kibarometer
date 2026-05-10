-- 0053_oppstart_methodology_keyword_only.sql
--
-- The /docs/oppstart methodology bullet seeded by 0043_site_content_docs.sql
-- says Tier 1 LLM "avgjør om foretaket faktisk driver med AI" — but the
-- public charts on /oppstart never use Tier 1 as a gate. AI-relevance is
-- decided at ingest by the keyword matcher (has_ai_in_name OR
-- has_ai_in_aktivitet); Tier 1 is internal-only discovery (verbatim phrase
-- extraction → keyword candidates pipeline). The "Mer om metode" footnote
-- added in PR #114 sends users to this page, so the contradiction misleads
-- in both directions.
--
-- Fix the seed text via two targeted replace() updates against
-- public.site_content.body_md for slug='docs-oppstart'. Each is guarded by
-- a LIKE so the migration is a no-op once the substring is gone — operator
-- edits made via /admin/content/docs-oppstart are preserved.
--
-- Idempotent. Re-running after the seed text is replaced does nothing.

-- 1. Replace the misleading Tier 1 detection bullet with two accurate
--    bullets: keyword matcher (the actual gate) and Tier 1 (internal
--    discovery, not a public-tally filter).
update public.site_content
   set body_md = replace(
       body_md,
       '- **Tier 1 LLM (deteksjon).** En lokal språkmodell leser aktivitetsbeskrivelsen og avgjør om foretaket faktisk driver med AI.',
       '- **AI-treff via nøkkelord.** Vi markerer foretak som AI-relevante når kuraterte AI-nøkkelord (f.eks. *AI*, *KI*, *machine learning*, *LLM*) matcher firmanavnet eller aktivitetsbeskrivelsen ved registrering. Listen redigeres i admin og evolverer.' || E'\n' ||
       '- **Tier 1 LLM (intern oppdaging).** En lokal språkmodell leser aktivitetsbeskrivelser blant AI-treffene og henter ut konkrete AI-fraser — disse mater nøkkelord-kandidat-pipen, ikke de offentlige tallene.'
     )
 where slug = 'docs-oppstart'
   and body_md like '%- **Tier 1 LLM (deteksjon).** En lokal språkmodell leser aktivitetsbeskrivelsen og avgjør om foretaket faktisk driver med AI.%';

-- 2. Replace the "NACE-bransjekoden er signal, ikke fasit" follow-up so it
--    no longer credits Tier 1 with the decision.
update public.site_content
   set body_md = replace(
       body_md,
       'Det er Tier 1 LLM som tar den faktiske beslutningen.',
       'Beslutningen ligger hos nøkkelord-matcheren ved registrering — Tier 1 brukes kun til intern oppdaging av nye fraser.'
     )
 where slug = 'docs-oppstart'
   and body_md like '%Det er Tier 1 LLM som tar den faktiske beslutningen.%';
