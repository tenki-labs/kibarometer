-- 0026_site_content_media.sql
-- Phase G follow-up: make the /media stub editable via /admin/content like
-- /om and /metode. Schema lives in 0011_site_content.sql; this migration
-- only seeds the row. Idempotent.

insert into public.site_content (slug, title, body_md) values
  (
    'media',
    'Media-barometer',
    $body$En oversikt over hvordan norske medier dekker AI i arbeidsmarkedet kommer snart.

I mellomtiden, se [Jobb-barometeret](/jobb-barometer) for daglig oppdaterte tall fra NAVs stillingsfeed.
$body$
  )
on conflict (slug) do nothing;
