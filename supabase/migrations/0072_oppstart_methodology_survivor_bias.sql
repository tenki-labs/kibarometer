-- 0072_oppstart_methodology_survivor_bias.sql
--
-- The /oppstart cohort-cards segment used to read as "Hvor mange overlever?"
-- and showed each årgang's alive %. The numbers were misleading: our BRREG
-- ingest pulls from `enhetsregisteret/api/enheter` (the *active* registry
-- plus a small tail of recently-slettet entities still in the bulk dump),
-- so historical cohorts contain only the surviving subset. The 100 % alive
-- share rendered on pre-bootstrap årganger was a tautology of the input,
-- not a real survival rate.
--
-- The PR that ships alongside this migration retitles the segment to
-- "Aktive KI-foretak per stiftelsesår" and drops the alive-% and tinting
-- entirely. Add a /docs/oppstart paragraph documenting the constraint so
-- the public methodology page is honest about what we can and can't see.
--
-- Idempotent — guarded by a substring check on body_md so re-runs after
-- the marker is present no-op. Operator edits via /admin/content/docs-oppstart
-- are preserved.

update public.site_content
   set body_md = body_md || E'\n\n' ||
$append$## Hvorfor vi ikke kan måle overlevelse historisk

**Vi ser bare overlevere.** BRREG-importen vår startet våren 2026 og henter fra Enhetsregisterets aktive register (`enhetsregisteret/api/enheter`). Foretak som ble stiftet før 2026 og slettet før importen kjørte er derfor ikke i vår database — de finnes ikke i datasettet vi henter fra. For årganger eldre enn et par år er antallet aktive KI-foretak vi viser et utvalg av overleverne, ikke en hel årgang.

Det betyr at vi ikke kan publisere overlevelses-prosenter eller dødelighet for KI-segmentet bakover i tid. Kort-segmentet "Aktive KI-foretak per stiftelsesår" på /oppstart viser antall aktive, innleveringsandel og medianomsetning blant filere — alle tall som er ærlige innenfor overleverne, men som ikke sier noe om hvor mange KI-foretak som ble stiftet og siden gikk konkurs eller ble slettet.

Fremoverrettet samler vi `slettet_dato` og `konkurs`-status for foretak som blir slettet etter importen, men en deletion-feed-synk er ikke wiret opp ennå — historisk drift vil derfor ikke kunne rekonstrueres.$append$
 where slug = 'docs-oppstart'
   and body_md not like '%## Hvorfor vi ikke kan måle overlevelse historisk%';
