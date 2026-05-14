-- 0071_oppstart_methodology_financials.sql
--
-- /oppstart got a financials layer in PR #153 (migration 0064) — three new
-- segments (Pareto/Gini, KI-relatert omsetning, cohort cards) backed by
-- Regnskapsregisteret data. But the /docs/oppstart methodology page
-- (seeded in 0043, patched in 0053) never picked up a section for it, so
-- there's no public explanation of:
--   1. The drain only fetches financials for AI-flagged orgnrs — there is
--      no baseline-cohort financial data, by design. Anything that used
--      to read "AI vs basislinje" on the public page has been retitled or
--      removed in the PR that ships alongside this migration.
--   2. Revenue numbers reflect the *whole* company's turnover, not the
--      AI-specific share — for some filers KI is the main business, for
--      others a smaller part of operations.
--   3. Coverage gaps from Regnskapsregisteret itself (small AS under
--      regnskapsplikt and ENK don't file at all).
--
-- Append a "Regnskap og KI-omsetning" section to the docs body via a
-- guarded UPDATE so operator edits made through /admin/content/docs-oppstart
-- are preserved. Once the marker substring is present the migration no-ops
-- on re-run.

update public.site_content
   set body_md = body_md || E'\n\n' ||
$append$## Regnskap og KI-omsetning

**Kun KI-flagga foretak.** Vi henter årsregnskap fra [Regnskapsregisteret](https://data.brreg.no/regnskapsregisteret/) (NLOD 2.0) kun for foretak som er flagget KI-relatert via nøkkelord-matcheren. Tallene har derfor ingen sammenligningsgruppe av ikke-KI-foretak — segmentene viser KI-sektoren alene, ikke et AI-vs-basislinje-bilde.

**Hele foretakets omsetning, ikke bare KI-andelen.** Når vi summerer omsetning for KI-relaterte foretak inkluderer vi *hele* `sum_driftsinntekter` fra årsregnskapet. For et rent KI-produktselskap er det dekkende; for et bredere konsulent- eller produkthus der KI er én av flere aktiviteter overdriver det den faktiske KI-omsetningen. Vi har ikke data for å skille ut den KI-spesifikke andelen.

**Kjent dekningssvakhet.** Små AS under regnskapsplikt og enkeltpersonforetak (ENK) leverer ikke årsregnskap, så de mangler fra omsetnings- og overlevelses-tallene selv om de teller i hovedvolumet. Cohort-kortene markerer overlevelse via Brønnøysund-status (`slettet_dato`, `konkurs`) — den biten er komplett uansett regnskapsplikt.$append$
 where slug = 'docs-oppstart'
   and body_md not like '%## Regnskap og KI-omsetning%';
