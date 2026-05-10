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

1. They have `is_ai_related = true` (set by the keyword matcher at
   ingest, in [media-processor.js:123](../lib/admin/legacy/media-processor.js#L123) —
   no LLM involved).
2. They have `tier2_completed_at IS NOT NULL` (Tier 2 LLM has assigned
   a category, stance, and intensity).
3. The snapshot tables (`media_snapshot_index`,
   `media_snapshot_category_daily`, `media_anomaly_daily`) have been
   refreshed since.

Tier 1 LLM (verbatim AI-phrase extraction) is *not* on this critical
path — its output feeds the keyword-catalog growth loop at
`/admin/keywords` and never gates the public charts.

Three things commonly block step 2:

- **`ingest_mode='backfill'` rows skip Tier 1 (and used to skip Tier 2
  by transitive dependency).** [Migration
  0050](../supabase/migrations/0050_ingest_mode.sql) introduced an
  `ingest_mode` column with default `'backfill'`. Tier 1 only processes
  rows where `ingest_mode='live'`
  ([llm-media-tier1.ts:78-82](../lib/admin/llm-media-tier1.ts#L78-L82)).
  Tier 2's selector now gates on `is_ai_related=true` directly, so
  historical rows can be categorized without first being Tier-1'd —
  see the "Reset / burst" playbook below.
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

## Lever 1 — Heal historical AI-flagging + drain Tier 2

When charts show gaps in older intervals, the cause is usually one of
two things:

1. **Keyword catalog has grown since those articles were ingested.**
   The keyword matcher only runs at ingest time; historical rows keep
   their old `is_ai_related=false` even after we add new keywords.
2. **Tier 2 hasn't categorized them yet.** Cron Tier 2 drains at
   ~60/hour (K=4 × 4 ticks/hour). After a keyword rematch, the queue
   can be many thousands of rows.

### Option 1A: Re-apply the current keyword catalog to historical rows

In `/admin/media`, click **"Re-apply keyword catalog (historical)"**.
This re-runs the keyword matcher against every row in
`media_articles` and flips `is_ai_related` to `true` on rows that
match the current catalog. Strict additive — only `false → true`,
never the reverse. No chart can lose points.

### Option 1B: LLM Tier 2 burst

After 1A, many rows have `is_ai_related=true` but
`tier2_completed_at IS NULL`. Click **"LLM Tier 2 burst"** in
`/admin/media`. Burst processes K=20/tick over a ~4 min wall budget,
newest-first. Charts heal from the right edge inward as Tier 2 drains.

The public coverage banner ("LLM-validert: X% av AI-treff i valgt
periode") shows progress in real time. Auto-hides at 100%.

### Option 1C: Promote backfill rows to live for forward Tier 1 coverage

Optional — only useful if you want phrase extraction to run on
historical articles for keyword-catalog growth (Tier 1 doesn't gate
the public charts):

```sql
update media_articles
   set ingest_mode = 'live'
 where ingest_mode = 'backfill'
   and is_ai_related = true
   and tier1_completed_at is null;
```

Run from the VPS via psql (see [CLAUDE.md §8](../CLAUDE.md#8-migrations)
for the `kiba-supabase-db` exec recipe). Tier 1 picks up at K=15/tick
(~225/hour).

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
  single digits. (Tier 2 backlog grows after a keyword rematch — drain
  via burst.)
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
