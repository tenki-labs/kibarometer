-- 0043_site_content_docs.sql
-- Seeds editable summary prose for /docs/jobbmarked, /docs/media, /docs/oppstart.
-- Each docs page also renders a hardcoded "Tekniske detaljer" <details> block in
-- JSX (cron schedule + endpoints + table names). That block is intentionally NOT
-- editable — it must track code, and putting it in markdown invites silent drift.
-- Idempotent: re-running this migration will not clobber operator edits.

insert into public.site_content (slug, title, body_md) values
  (
    'docs-jobbmarked',
    'Slik måler vi jobbmarkedet',
    $body$/jobbmarked teller AI-relaterte stillingsutlysninger i Norge. Tallene oppdateres én gang i døgnet, basert på [NAVs offentlige stillingsfeed](https://navikt.github.io/pam-stilling-feed/).

## Slik fungerer det

- **Henting.** Hver morgen kl. 06:00 henter vi gårsdagens nye stillinger fra NAV. Det vi får først er en kort versjon: tittel, arbeidsgiver, sted.
- **Berikelse.** Fire ganger i timen henter vi den fulle stillingsteksten for stillinger som mangler den.
- **Deteksjon.** En lokal språkmodell (Gemma 3) leser hver stilling og avgjør om den er AI-relatert, og hvilke verktøy/roller/konsepter som nevnes.
- **Klassifisering.** AI-stillinger plasseres i ferdighetskategorier (f.eks. *ML Engineering*, *Data Analyse*, *MLOps*).
- **Snapshot.** Kl. 04:00 hver natt regner vi ut alle dashboardtallene på nytt.

## Hva tallene betyr

En stilling regnes som **AI-relatert** når minst ett kuratert begrep treffer i tittel eller fulltekst, eller når språkmodellen bekrefter relevans der nøkkelord ikke matcher. Begrepslista finner du på [/metode](/metode).

**«Lavt utvalg»** vises på rader med færre enn 10 AI-stillinger i vinduet. Geografi-tall er minst pålitelige for fylker med liten samlet stillingstilgang.

**Recall avhenger av berikelse.** Helt ferske stillinger som ennå ikke har full tekst merkes på tittel alene — de kan få full tagging timer senere når detaljen er hentet.$body$
  ),
  (
    'docs-media',
    'Slik måler vi mediedekningen',
    $body$/media måler hvor ofte og hvor varmt norske medier omtaler kunstig intelligens. Vi sporer aktive nyhetskilder og publiserer en daglig dekkings-temperatur.

## Slik fungerer det

- **Oppdagelse.** Fire ganger i timen leser vi RSS-feedene til kildene våre, filtrerer på AI-nøkkelord i tittel og ingress, og legger interessante artikler i en kø.
- **Henting og parsing.** Tolv ganger i timen henter vi artikkel-HTMLen, ekstraherer brødteksten, og beregner et fingeravtrykk for å oppdage byrå-gjenbruk.
- **Tier 1 LLM (deteksjon).** En lokal språkmodell bekrefter relevans og henter ut hvilke AI-fraser som nevnes (verbatim).
- **Tier 2 LLM (kategorisering).** AI-relevante artikler klassifiseres i kategori (f.eks. *Politikk*, *Forskning*, *Næringsliv*) og scores for *holdning* og *intensitet*.
- **Snapshot.** Kl. 04:30 hver natt regner vi ut alle dashboardtallene på nytt.

## Hva tallene betyr

**Vi lagrer aldri brødteksten** av noen artikkel. Bare metadata, korte sitater for verifisering, og våre egne klassifiseringer. Dette er av hensyn til opphavsrett.

**«Holdning»** måler hvilket lys AI presenteres i, ikke om artikkelen er for eller mot AI-utvikling generelt. En kritisk reportasje om en konkret AI-feil får negativ holdning selv om journalisten er nøytral.

**«Intensitet»** måler hvor sentralt AI er i artikkelen. En sak om strømpriser som nevner AI én gang får lav intensitet; en sak som hovedsakelig handler om AI får høy.

**Wire-clustering.** Når flere medier publiserer samme NTB- eller AP-melding teller vi det som *ett* dekkings-tema, ikke fem.$body$
  ),
  (
    'docs-oppstart',
    'Slik måler vi nye AI-selskaper',
    $body$/oppstart teller nyregistrerte norske foretak som driver med AI eller AI-tilstøtende virksomhet. Data hentes fra [Brønnøysundregistrene](https://www.brreg.no/) sin Enhetsregister-API.

## Slik fungerer det

- **Daglig innhenting.** Hver morgen kl. 06:30 henter vi alle foretak registrert dagen før — navn, organisasjonsnummer, NACE-bransjekode, aktivitetsbeskrivelse.
- **Rolle-berikelse.** To ganger i timen henter vi rolleinnehavere (daglig leder, styremedlemmer, innehavere) for nye foretak. Det gir oss bl.a. gründernes alder.
- **Tier 1 LLM (deteksjon).** En lokal språkmodell leser aktivitetsbeskrivelsen og avgjør om foretaket faktisk driver med AI.
- **Tier 2 LLM (kategorisering).** AI-foretak klassifiseres i kategorier (f.eks. *AI-konsulent*, *AI-produkt*, *Forskning*).
- **Snapshot.** Kl. 04:45 hver natt regner vi ut alle dashboardtallene på nytt.

## Hva tallene betyr

**«AI-relatert» her ≠ AI-relatert i jobbmarkedet.** I oppstart-pipelinen kreves det at *foretakets formål* er AI, ikke bare at AI nevnes. Et regnskapskontor som bruker AI-verktøy regnes ikke med.

**NACE-bransjekoden er signal, ikke fasit.** Mange AI-selskaper registreres under generelle koder (62.010 — programvareutvikling, 72.110 — forskning). Det er Tier 1 LLM som tar den faktiske beslutningen.

**«Gründer-alder»** er den yngste rolle-personen registrert innen 30 dager etter foretaks-registreringen. Personer som kommer inn senere regnes ikke som gründere.$body$
  )
on conflict (slug) do nothing;
