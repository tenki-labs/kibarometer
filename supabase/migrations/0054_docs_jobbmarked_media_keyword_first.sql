-- 0054_docs_jobbmarked_media_keyword_first.sql
--
-- Sister migration to 0053 — corrects the /docs/jobbmarked and /docs/media
-- methodology prose seeded by 0043_site_content_docs.sql. Both pages
-- currently say the LLM "avgjør om den er AI-relatert" / "bekrefter
-- relevans" — that is wrong. AI-relevance is decided at ingest by the
-- keyword matcher (nav-processor.js for jobs, media-processor.js for
-- articles). The LLM tiers only enrich rows that the keyword matcher
-- already flagged.
--
-- Each replace() is guarded by a LIKE so the migration is a no-op once
-- the bad substring is gone — operator edits made via /admin/content/<slug>
-- are preserved.
--
-- Idempotent.

-- jobbmarked — replace the "Deteksjon" pipeline bullet.
update public.site_content
   set body_md = replace(
       body_md,
       '- **Deteksjon.** En lokal språkmodell (Gemma 3) leser hver stilling og avgjør om den er AI-relatert, og hvilke verktøy/roller/konsepter som nevnes.',
       '- **AI-treff via nøkkelord.** Ved henting markerer vi stillingen som AI-relatert når kuraterte AI-nøkkelord (f.eks. *AI*, *KI*, *machine learning*, *LLM*) matcher tittel eller fulltekst. Listen redigeres i admin og utvides over tid.' || E'\n' ||
       '- **Tier 1 LLM (intern oppdaging).** Blant AI-treff henter en lokal språkmodell (Gemma 3) ut konkrete AI-fraser ord-for-ord — disse mater nøkkelord-kandidat-pipen, ikke de offentlige tallene.'
     )
 where slug = 'docs-jobbmarked'
   and body_md like '%- **Deteksjon.** En lokal språkmodell (Gemma 3) leser hver stilling og avgjør om den er AI-relatert, og hvilke verktøy/roller/konsepter som nevnes.%';

-- jobbmarked — replace the "Hva tallene betyr" sentence that credits the
-- LLM with relevance confirmation.
update public.site_content
   set body_md = replace(
       body_md,
       'En stilling regnes som **AI-relatert** når minst ett kuratert begrep treffer i tittel eller fulltekst, eller når språkmodellen bekrefter relevans der nøkkelord ikke matcher.',
       'En stilling regnes som **AI-relatert** når minst ett kuratert begrep treffer i tittel eller fulltekst. Språkmodellen brukes ikke som filter — den henter bare ut nye fraser fra AI-treff for å utvide nøkkelord-listen over tid.'
     )
 where slug = 'docs-jobbmarked'
   and body_md like '%eller når språkmodellen bekrefter relevans der nøkkelord ikke matcher.%';

-- media — replace the "Tier 1 LLM (deteksjon)" bullet that says the LLM
-- confirms relevance.
update public.site_content
   set body_md = replace(
       body_md,
       '- **Tier 1 LLM (deteksjon).** En lokal språkmodell bekrefter relevans og henter ut hvilke AI-fraser som nevnes (verbatim).',
       '- **AI-treff via nøkkelord.** Ved henting markerer vi artikkelen som AI-relatert når kuraterte AI-nøkkelord matcher tittel eller ingress. Listen redigeres i admin og utvides over tid.' || E'\n' ||
       '- **Tier 1 LLM (intern oppdaging).** Blant AI-treff henter en lokal språkmodell ut konkrete AI-fraser ord-for-ord — disse mater nøkkelord-kandidat-pipen, ikke de offentlige tallene.'
     )
 where slug = 'docs-media'
   and body_md like '%- **Tier 1 LLM (deteksjon).** En lokal språkmodell bekrefter relevans og henter ut hvilke AI-fraser som nevnes (verbatim).%';
