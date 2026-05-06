-- 0031_site_content_mediedekning.sql
-- Seeds the editable intro / methodology copy for the public
-- /mediedekning page (PR 8 of 9). Pattern mirrors /om, /metode, /media —
-- prose body lives in site_content; chart-driven sections stay in JSX.
-- Idempotent.

insert into public.site_content (slug, title, body_md) values
  (
    'mediedekning',
    'Medietemperaturen',
    $body$Hvor varmt — eller kaldt — snakker norske medier om kunstig intelligens akkurat nå?

**Kibarometer-temperaturen** er et sammensatt mål basert på alle AI-relaterte saker fra et utvalg norske outletter de siste sju dagene. 50 betyr balansert dekning. Lavere enn 50 er en tyngde mot bekymring eller kritikk; høyere er en tyngde mot entusiasme. Hver artikkel klassifiseres med en stance (alarmed, kritisk, nøytral, policy-debatt, personlig historie eller entusiastisk) og en intensitet, og snittet skaleres til 0–100.

Tallet er smoothet over sju dager fordi enkelte dager er for stille til å gi mening alene. Per kategori vises temperaturen som et heatmap, og uvanlig høy aktivitet flagges automatisk.

Vi lagrer aldri artikkeltekst — bare metadata, klassifisering og avledet analyse. Det er en bevisst kompromiss for å holde oss på riktig side av opphavsrett.
$body$
  )
on conflict (slug) do nothing;
