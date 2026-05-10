# Media data runbook

How to grow `/media`'s dataset when the public page looks empty. The
front-end fixes (PR for `feat/media-reliability`) make charts honest
about thin data and add a "Data fra X — N dager dekning" coverage
banner on the hero. This runbook covers the *pipeline* side — what an
operator does to actually fill those charts.

The pipeline has three independent levers. Pull them in order. Each
section names the file or admin page involved so you can verify what's
in front of you before changing anything.

---

## Where the data wall is

[`media_articles`](../supabase/migrations/0029_media.sql) is the fact
table. Articles only appear on `/media` when:

1. They have `is_ai_related = true` (Tier 1 confidence + phrase
   extraction has run).
2. They have `tier2_completed_at IS NOT NULL` (Tier 2 has assigned a
   category, stance, and intensity).
3. The snapshot tables (`media_snapshot_index`,
   `media_snapshot_category_daily`, `media_anomaly_daily`) have been
   refreshed since.

Three things commonly block step 1:

- **`ingest_mode='backfill'` rows skip Tier 1.** [Migration
  0050](../supabase/migrations/0050_ingest_mode.sql) introduced an
  `ingest_mode` column with default `'backfill'`. Tier 1 only processes
  rows where `ingest_mode='live'`
  ([llm-media-tier1.ts:78-82](../lib/admin/llm-media-tier1.ts#L78-L82)).
  Every article ingested *before* that migration defaults to
  `'backfill'`. Without intervention they never reach Tier 1, never
  reach Tier 2, never appear on `/media`.
- **Only 2 of 32 sources are active by default.** Digi.no + Kode24
  ([0029_media.sql](../supabase/migrations/0029_media.sql)). The 18
  outlets added by [0035_more_media_sources.sql](../supabase/migrations/0035_more_media_sources.sql)
  ship `is_active=false`. RSS discover
  ([media-discover.js](../lib/admin/legacy/media-discover.js))
  filters to `is_active=true&rss_url=not.is.null`.
- **The pipeline only started ingesting around 2026-05-05.** Even with
  every other lever pulled, calendar coverage is bounded by when ingest
  began.

---

## Lever 1 — Free Tier 1 over historical rows

The single biggest source of ghost-empty charts is articles stuck at
`ingest_mode='backfill'` with `tier1_completed_at IS NULL`.

**Pick one of these. Do *not* run both.**

### Option 1A: Promote existing AI-suspect rows to live

Lowest-effort. Targets only rows where the keyword matcher already
flagged AI-relevance (so we don't burn LLM calls on noise):

```sql
update media_articles
   set ingest_mode = 'live'
 where ingest_mode = 'backfill'
   and is_ai_related = true
   and tier1_completed_at is null;
```

Run from the VPS via psql (see [CLAUDE.md §8](../CLAUDE.md#8-migrations)
for the `kiba-supabase-db` exec recipe). Tier 1 will pick the rows up
on the next 4×/hour cron tick and drain at K=15 per tick (~225/hour).

**Estimate the cost first.** Run `select count(*)` with the same `where`
clause to get the row count. At ~3 s per LLM call, ~225 rows/hour fall
through Tier 1. Tier 2 then runs at K=4 per tick (~60/hour). Plan for
24-48 hours of background drain on a thousand-row backfill.

### Option 1B: Add a "Tier 1 backfill" admin button

Higher-effort but more controlled. Modify
[lib/admin/llm-media-tier1.ts](../lib/admin/llm-media-tier1.ts) to
accept an `includeBackfill` flag and add a button on `/admin/media` that
schedules a one-shot job. Out of scope for the
`feat/media-reliability` PR — open a separate change if you want this.

---

## Lever 2 — Activate more media sources

The 18 dormant sources from [0035_more_media_sources.sql](../supabase/migrations/0035_more_media_sources.sql)
each need three things before they contribute:

1. **A populated `search_config`.** Used by `media-backfill` for site
   search. The seeded value is `null` for these rows. Edit the source
   in [/admin/media/sources](../app/admin/(app)/media/sources) and
   provide either a search-config JSON (preferred) or a sitemap URL.
2. **`is_active = true`.** Same admin page; toggle it on once
   `search_config` is set.
3. **A reachable `rss_url`.** Already seeded for most rows; verify it
   resolves (curl from the VPS).

**Recommended order**: pick five high-volume mainstream outlets first
(NRK, VG, Aftenposten, E24, Dagens Næringsliv) so the dataset diversifies
beyond tech publications. Wait for one cron cycle, watch
[/admin/media/queue](../app/admin/(app)/media/queue) for inflow. Then
turn on the next batch.

---

## Lever 3 — Run a one-time backfill burst

Once Lever 2 is in place for a source, click **"Backfill"** on the
source page in [/admin/media/sources](../app/admin/(app)/media/sources/[id]).
That enqueues historical URLs into `media_url_queue`. The
`media-fetch-classify` cron drains the queue (~4×/hour). Tier 1 and
Tier 2 then process the resulting `media_articles` rows in their own
ticks.

**Time-box**: 24-48 hours per source for the queue + tiers to drain.
Watch the queue depth and the "tier1 pending" / "tier2 pending" counts
on /admin/media/queue.

---

## After the levers settle

The `media_snapshot_*` tables are populated by `refresh_all_media_snapshots()`
([0029_media.sql](../supabase/migrations/0029_media.sql)). It runs on
its own cron (see [scripts/fetcher-crontab](../scripts/fetcher-crontab)).
Confirm a snapshot row exists for today's date:

```sql
select max(date) from media_snapshot_index;
select max(published_on) from media_snapshot_category_daily;
```

Then load `/media` — the coverage banner on the hero will show the new
horizon.

---

## What "looks healthy" should look like

When the levers are pulled and a few weeks have elapsed:

- `/admin/media/queue` shows tier1_pending and tier2_pending in the
  single digits.
- `media_snapshot_category_daily` has rows for every active category on
  most days (a few will be sparse in low-coverage weeks; that's fine).
- `media_snapshot_index.categories_above_water + categories_below_water`
  > 0 most days (the old "Kategorier over null" stat). The ghost stat
  has been removed from the public page, but the columns remain in the
  table for ops monitoring.
- `/media` with `?range=1y` shows ≥3 monthly buckets (the
  `MIN_MONTHLY_BUCKETS` threshold from
  [app/(site)/_lib/range.ts](../app/(site)/_lib/range.ts)). The hero's
  coverage banner will read "{N} dager dekning" with N > 90.

If any of those drift back, walk the levers again from Lever 1.
