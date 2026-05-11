# /oppstart data reliability — reference

Notes captured while fixing the May 2026 incident where the AI-andel chart
on production rendered "jan/feb/mars/apr 2018" on the 1-year view, and the
"Topp kategorier" filter was leaking zero-share categories into the
colored swatch row underneath the chart. Use this as the map for future
incidents on the same surface.

## Data flow, end to end

```
                                   Brønnøysundregistrene API
                                              │
            kiba-fetcher cron (06:30 UTC)     │
                                              ▼
                                    brreg-ingest job
                                  (POST /admin/api/jobs/brreg-ingest)
                                              │
                              keyword matcher runs once at ingest:
                              has_ai_in_name OR has_ai_in_aktivitet
                                              ▼
                                    public.brreg_companies
                                       (raw row + keyword
                                        flags + matched_keywords_*)
                                              │
              kiba-fetcher cron (04:45 UTC)   │
                                              ▼
                          refresh_all_brreg_snapshots()
                          truncate-and-rebuild every snapshot table
                                              │
        ┌─────────────────┬───────────────────┼────────────────────┐
        ▼                 ▼                   ▼                    ▼
brreg_snapshot_daily   _headline   _founder_age_monthly   _keywords / _geography / _cohort
        │                 │                   │                    │
        └────────────────┬┴───────────────────┴────────────────────┘
                         │ via PostgREST (anon key, public-read RLS)
                         ▼
                 app/(site)/oppstart/page.tsx
                  (server component, revalidate=60)
                         │
                         ▼
                    Scroller (client)
                  builds buckets/series in-memory
```

Cron sources of truth:
- `[scripts/fetcher-crontab](../scripts/fetcher-crontab)` — schedule.
- `refresh_all_brreg_snapshots()` — orchestrator, defined in
  `[supabase/migrations/0052_brreg_snapshot_keywords.sql](../supabase/migrations/0052_brreg_snapshot_keywords.sql)`
  (latest definition, supersedes 0048/0051).
- `[supabase/migrations/0030_brreg.sql](../supabase/migrations/0030_brreg.sql)`
  defines `brreg_companies` and the original snapshot tables.
- `[supabase/migrations/0047_brreg_2018_floor.sql](../supabase/migrations/0047_brreg_2018_floor.sql)`
  pins the snapshot date floor at 2018-01-01 and coalesces null NACE
  slugs to `'annet'`.

## What "AI-relevant" actually means here

`brreg_companies.is_ai_relevant` is a **generated** boolean:
`generated always as (has_ai_in_name or has_ai_in_aktivitet) stored`.

`has_ai_in_*` are set by the keyword matcher in
`[lib/admin/legacy/brreg-processor.js](../lib/admin/legacy/brreg-processor.js)`
at **ingest time** — once per company. It is _not_ refreshed when the
keyword list evolves; manual reprocess via the admin UI sets `retagged_at`.

Tier-1 LLM also runs against `is_ai_relevant=true AND tier1_completed_at IS NULL`
rows (~4×/hour cron) and stores verbatim AI-phrases in `llm_ai_phrases` —
but **the public `/oppstart` charts never use this**. Tier-1 is for
discovery only (phrase extraction → keyword candidates pipeline), not
as a gate. It does NOT validate AI-relevance and does NOT write
`is_ai_relevant`.

So the chart copy carefully says:

> AI-relevant = treff på kuraterte nøkkelord i firmanavn eller aktivitet
> ved registrering.

Don't let this drift to "AI-confirmed" or "LLM-validated" without
re-thinking the SQL gating in `refresh_brreg_snapshot_daily()`.

## The PostgREST 1000-row trap

The single highest-leverage thing to know:
**`PGRST_DB_MAX_ROWS` defaults to 1000.** Any anon-key PostgREST query
that asks for more rows is silently truncated at 1000, with the response
header `content-range: 0-999/<total>` as the only signal.

In our compose this used to be `${PGRST_DB_MAX_ROWS:-1000}`. The page
asks for `limit=200000` against `brreg_snapshot_daily?order=registrert_dato.asc`
— which gave the chart the **first 1000 rows** = the oldest 75 days =
2018-Q1 only. That was the entire 2018 incident.

Fix lives in
`[docker/supabase/docker-compose.yml](../docker/supabase/docker-compose.yml)`
on the `kiba-supabase-rest` and `kiba-supabase-meta` services:
`PGRST_DB_MAX_ROWS: ${PGRST_DB_MAX_ROWS:-1000000}`.

To inspect: `curl -sI -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Prefer: count=exact" '<url>'`
and look at `content-range`. If you see `0-999/<total>` and total >
999, that's the cap biting.

After changing the default, postgrest needs a restart:
`docker compose -f /opt/kibarometer/website/docker/supabase/docker-compose.yml up -d kiba-supabase-rest kiba-supabase-meta`.
The deploy.sh path doesn't restart supabase services — see CLAUDE.md §5.

## Scroller filter logic

`[app/(site)/oppstart/_components/scroller.tsx](../app/(site)/oppstart/_components/scroller.tsx)`
holds two builder functions worth understanding:

### `buildAiShareBuckets`

Sums `count` and `ai_relevant_count` per (date|month) bucket within the
range cutoff. Returns `AIShareBucket[]` for the area chart. **Does not
filter by AI count > 0** — buckets with zero AI still render with 0%
share, which is the right behaviour for a share-over-time line.

### `buildCategoryMixSeries`

Three filters stack to keep the legend honest:

1. `if (row.ai_relevant_count === 0) continue` — daily rows with zero AI
   contribution don't enter the bucket.
2. `if (HIDDEN_CATEGORY_SLUGS.has(row.nace_category_slug)) continue` —
   `'annet'` (the null-NACE catch-all) never appears as a band.
3. Per-slug post-aggregation gate:
   - `slugTotal >= MIN_CATEGORY_COUNT` (default 5) — drops categories
     with fewer than 5 AI companies in the active window.
   - `slugTotal / windowAiTotal >= MIN_CATEGORY_SHARE` (default 0.005 =
     0.5%) — drops slivers that mathematically can't render.

A dev-only `console.error` fires if any zero-sum slug survives the
filter — a regression catch, not user-visible.

If you want to surface a dropped category, raise the thresholds rather
than punching a hole in the filter — every chart it touches should
honour the same gates.

## Transparency UI

Three small touches keep the keyword-only signal honest under stale data:

- **Hero `oppdatert`**: `headline.computed_at` formatted as
  `10. mai 2026`. If older than `STALE_AFTER_MS = 48h`, the date renders
  in `text-amber-600` so a missed cron is loud.
- **Per-section `Oppdatert {dato}`** below each chart, in `text-[0.7rem]
  text-muted-foreground`.
- **Methodology footnote** below the AI-using charts (`AI-andel`, `Topp
  kategorier`, `Median alder`): single sentence stating
  keyword-only + a `[Mer om metode](/docs/oppstart)` link.

Server-side `Date.now()` is forbidden by the new `react-hooks/purity`
rule; the hero captures `stale` once via `useState(() => …)` initializer
and lets the page's 60s revalidation handle long-lived staleness.

## How to diagnose the next "the chart looks wrong" report

1. **Confirm freshness.** SSH to the VPS, run:
   ```bash
   PGPW=$(grep '^POSTGRES_PASSWORD=' /opt/kibarometer/env/supabase.env | cut -d= -f2)
   docker exec -i -e PGPASSWORD="$PGPW" kiba-supabase-db psql -U postgres -d postgres -c \
     "select min(registrert_dato), max(registrert_dato), count(*) from public.brreg_snapshot_daily;"
   ```
   `max` should be within 1–2 days of `current_date`.
2. **Confirm the page can actually fetch what it needs.** Hit the
   PostgREST endpoint with the anon key and look at `content-range`:
   ```bash
   curl -sI -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
     "https://kibarometer.no/supabase/rest/v1/brreg_snapshot_daily?limit=200000&order=registrert_dato.asc&select=registrert_dato"
   ```
   If `content-range: 0-999/<bigger>`, the cap is back.
3. **Check the cron logs.** `docker exec kiba-fetcher tail -n 50
   /var/log/last-brreg-ingest.log` and `last-brreg-snapshots.log`
   on the VPS show the JSON body of the last run for each job. A
   `status: success` block dated today is what you want.
4. **Manually run a refresh.**
   ```sql
   select public.refresh_all_brreg_snapshots();
   ```
   Times out at 10 minutes (`statement_timeout` set in the function via
   migration 0042). If it times out, snapshot refresh is too heavy —
   that's a real engineering problem, not a config one.
5. **If keyword matcher seems wrong** (rows have `is_ai_relevant=false`
   but the name/aktivitet obviously contains AI keywords): compare
   `count(*) filter (where has_ai_in_name)` vs `(where has_ai_in_aktivitet)`
   by month. If one column collapses around a specific date, look at
   commits to `lib/admin/legacy/brreg-processor.js` and the `keywords`
   table around that date.

## Out of scope here

- The same patterns apply to `/arbeidsmarked` (`snapshot_*`) and `/media`
  (`media_snapshot_*`). The PostgREST cap fix benefits all three; the
  filter / transparency UI is per-page.
- A `tier1_ai_relevant boolean generated always as ((llm_ai_phrases->>'ai_relevant')::boolean) stored`
  column on `brreg_companies` would make the LLM signal queryable and
  let us add a side-by-side "keyword-matched vs LLM-confirmed" overlay.
  Not built — Tier-1 is too slow and the user wants the keyword signal
  as the headline number.
