-- 0069_site_content_landing_version.sql
-- Adds the footer version label on the landing page as an editable
-- site_content row. The landing page renders the row's `title` verbatim
-- (e.g. "Versjon 1.0"); `body_md` is operator-facing documentation and
-- is not displayed publicly.
--
-- Idempotent.

insert into public.site_content (slug, title, body_md) values
  (
    'landing-version',
    'Versjon 1.0',
    $body$Footer-versjon på forsiden (kibarometer.no/).

Kun **tittelfeltet** vises på siden — brødtekst ignoreres og er kun
for operatør-notater. Endringer publiseres umiddelbart (ISR-cache for
`/` tømmes ved lagring).
$body$
  )
on conflict (slug) do nothing;
