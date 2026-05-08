-- 0045_metode_to_docs.sql
-- Retires /metode in favour of per-pipeline docs. Methodology prose moves
-- into a new editable "Sammendrag" section on /docs (slug = docs); the live
-- keyword catalogue + AI-skill taxonomy + media-source list move to
-- /docs/nokkelord (hardcoded JSX reading live tables); API/embed snippets
-- move to /docs/api (hardcoded JSX).
--
-- We DELETE the metode row so the admin /content list stops showing it.
-- 0011_site_content.sql still seeds it on fresh installs, but this migration
-- runs after 0011 in the deploy loop, so the net result is correct.
--
-- Idempotent: the DELETE is a no-op if the row is already gone, the INSERT
-- uses ON CONFLICT DO NOTHING so re-running never clobbers an operator edit.

delete from public.site_content where slug = 'metode';

insert into public.site_content (slug, title, body_md) values
  (
    'docs',
    'Sammendrag',
    $body$Kibarometeret er et uavhengig dashbord som sporer hvordan kunstig intelligens påvirker norsk arbeidsliv, mediebilde og næringsetablering. Tre datapipeliner mater dashboardene: [NAVs stillingsfeed](/docs/jobbmarked), [RSS-feeder fra norske medier](/docs/media), og [Brønnøysundregistrene](/docs/oppstart).

Hver pipeline har sin egen klassifiseringslogikk og kjente begrensninger — klikk på et av kortene over for å lese hvordan den enkelte fungerer.

For levende nøkkelordlister, AI-ferdighetskategorier og medie-kilder, se [/docs/nokkelord](/docs/nokkelord). For API- og embed-snippets, se [/docs/api](/docs/api).$body$
  )
on conflict (slug) do nothing;
