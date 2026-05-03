-- 0011_site_content.sql
-- Phase G: editable copy for the static marketing pages (/om and /metode).
--
-- Each row is one editable page identified by a slug. body_md is markdown,
-- rendered server-side by lib/admin/markdown.ts (a tiny in-repo paragraph +
-- heading + link converter — no npm dep).
--
-- Public read so the marketing site can fetch with the anon key + ISR.
-- Staff write (admin or super_admin only — read_only/employee can view but
-- not edit, matching the keywords table's split).
--
-- Idempotent.

create table if not exists public.site_content (
  slug text primary key,
  title text not null,
  body_md text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

drop trigger if exists site_content_updated_at on public.site_content;
create trigger site_content_updated_at before update on public.site_content
  for each row execute function public.trigger_set_updated_at();

alter table public.site_content enable row level security;

drop policy if exists site_content_public_read on public.site_content;
create policy site_content_public_read on public.site_content
  for select using (true);

drop policy if exists site_content_admin_write on public.site_content;
create policy site_content_admin_write on public.site_content
  for all
  using (public.is_admin_or_super())
  with check (public.is_admin_or_super());

-- Seed both editable pages with their current hardcoded copy. on conflict
-- do nothing so re-running the migration never clobbers an operator edit.
insert into public.site_content (slug, title, body_md) values
  (
    'om',
    'Om Kibarometeret',
    $body$Kibarometeret er et uavhengig dashbord som sporer AI-relaterte stillinger i norsk arbeidsmarked. Vi henter rådata fra NAVs offentlige stillingsfeed, kjører vår egen analyse og publiserer tall journalister kan sitere.

## Hvem står bak

Kibarometeret drives av [Tenki Labs](https://tenki.no), ansvarlig redaktør og forfatter er Oscar Gangstad Westbye.

## Kontakt

Spørsmål om metodikk, sitering eller potensielle feil: [oscar@tenki.no](mailto:oscar@tenki.no). For tekniske bidrag eller forslag til nøkkelord, bruk [GitHub-issues](https://github.com/tenki-labs/kibarometer/issues).

## Sitering

Tallene er gratis å bruke i nyhets- og forskningsøyemed. Vi setter pris på en kreditering til *Kibarometeret / Tenki Labs* og en lenke til kibarometer.no eller den dato-pinnede permalinken (`?as_of=ÅÅÅÅ-MM-DD`).
$body$
  ),
  (
    'metode',
    'Hvordan vi måler',
    $body$Kibarometeret leser [NAVs stillingsfeed](https://navikt.github.io/pam-stilling-feed/) og merker en stilling som *AI-relatert* hvis tittelen, beskrivelsen eller yrkesfeltet inneholder ett eller flere av begrepene i listen under. Listen er kuratert manuelt og redigeres åpent.

## Hva «AI-relatert» betyr

Vi bruker en inkluderingsliste av begreper på engelsk og norsk, fordelt på *verktøy* (PyTorch, OpenAI, Hugging Face …), *roller* (ML Engineer, Dataforsker …) og *konsepter* (machine learning, kunstig intelligens, RAG …). Ord-treff bruker unicode-bevisste ordgrenser slik at norske bokstaver (æ ø å) håndteres riktig.

En stilling regnes som AI-relatert dersom **minst ett** begrep treffer. Vi viser hvilke begreper som matchet på den enkelte radens lenke til denne siden.

## Kjente begrensninger

- **«transformer»** kan også bety krafttransformator. Vi overvåker falske positive ukentlig — meld fra hvis du ser noe rart.
- **Bare-akronymer som AI, KI, ML** er kraftige men støyete. NLP kan også bety nevro-lingvistisk programmering. Word-boundary-matching reduserer støy, men ikke fjerner den.
- **Recall avhenger av berikelse.** Stillinger får full tagging (tittel + beskrivelse) først etter at vi har hentet detaljpost fra NAV. Stillinger som er ferske og fortsatt i berikelseskøen merkes på tittel alene.
- **«Lavt utvalg»-merket** vises på rader med færre enn 10 AI-stillinger i vinduet. Andelene i Geografi er minst pålitelige for fylker med liten samlet stillingstilgang.

## Foreslå et nøkkelord

Saker mangler? Ord som ikke burde regnes som AI? [Åpne en issue på GitHub](https://github.com/tenki-labs/kibarometer/issues/new?template=keyword-suggestion.yml) — det er et strukturert skjema med felt for begrep, språk og eksempelutlysning. Alle endringer skjer åpent.
$body$
  )
on conflict (slug) do nothing;
