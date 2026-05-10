# `/jobbmarked` data pipeline reference

How the page is wired together — what every visible number comes from, which
snapshot it reads, and the predicate footguns that have already burned us.

Last verified against `supabase/migrations/0008_nav_snapshots.sql` and
`0027_snapshot_categories_daily.sql`.

## The journey of one NAV posting

```
NAV stillingsfeed
   │
   ▼
nav_postings ──────── (raw rows: title, description, posted_at, county, …)
   │
   ▼  Tier 0 — keyword match (lib/admin/legacy/nav-processor.js)
nav_postings.is_ai = bool, nav_postings.matched_keywords = text[]
   │
   ▼  Tier 1 — relevance + verbatim phrase extraction (LLM)
   │  app/admin/api/jobs/llm-discover, lib/admin/llm-discover.ts
   │  writes ai_phrases, ai_relevance_confirmed
   │
   ▼  Tier 2 — taxonomy classification (LLM)
   │  app/admin/api/jobs/llm-classify, lib/admin/llm-classify.ts
   │  writes category (yrkeskategori) + skill_slugs[] (taxonomy)
   │
   ▼  Nightly snapshot refresh (04:00 cron, scripts/fetcher-crontab)
   │  RPC: refresh_all_snapshots() — 0027_…sql
   ▼
snapshot_*  ────►  PostgREST  ────►  /jobbmarked
```

`is_ai` is set by Tier 0 (cheap keyword match). `category` and skill `slug` are
only populated after the LLM tiers finish — so any snapshot keyed on either
field is *a subset* of what `is_ai` alone counts.

## Snapshot tables consumed by `/jobbmarked`

| Table                            | Predicate                                  | Used by               | Notes                                                                       |
| -------------------------------- | ------------------------------------------ | --------------------- | --------------------------------------------------------------------------- |
| `snapshot_headline`              | `is_ai` only, no enrichment requirement    | Hero (segment 1)      | One row/day, full history. `ai_count_30d`, `ai_count_7d`, `ai_share_30d`.   |
| `snapshot_daily`                 | `is_ai` only, per-day aggregate            | AI-share area (seg 2) | Per-day `ai_count` + `total_count` over **all** NAV postings.               |
| `snapshot_skill_category_daily`  | `is_ai` AND `slug is not null` (Tier 2)    | Skill area (seg 3)    | Sparse until LLM Tier 2 catches up. Inherently smaller than the hero.       |
| `snapshot_keywords`              | `is_ai` AND keyword match                  | Keyword list (seg 4)  | Top 20 by 30-day count.                                                     |
| `snapshot_geography`             | `is_ai`, county aggregate                  | Norway map (seg 5)    | Per-fylke `ai_count_30d` + `total_count_30d`.                               |

`snapshot_category_daily` is **not** consumed by `/jobbmarked` (it was wired up
in the AI-share rewrite of PR #106 and removed in this PR — see "Pitfalls"
below).

## Predicate parity rules

The hero number (`ai_count_30d`) is the canonical "AI postings, last 30 days"
on the page. Anything that wants to *add up to* that number must use the same
predicate. That means:

| Wants to match the hero? | Required source                           | Required filter             |
| ------------------------ | ----------------------------------------- | --------------------------- |
| Yes — segment 2 trend    | `snapshot_daily`                          | `is_ai`, no enrichment      |
| Yes — segment 5 map      | `snapshot_geography`                      | `is_ai`, no enrichment      |
| **No** — segment 3 mix   | `snapshot_skill_category_daily`           | `is_ai` AND classified      |

If you find yourself summing counts from `snapshot_skill_*` and comparing to
the hero, stop — that comparison is meaningless until LLM Tier 2 has zero lag
(which it never does steadily).

## PostgREST row cap (the silent footgun)

`docker/supabase/docker-compose.yml` sets `PGRST_DB_MAX_ROWS=1000` on both
the `rest` and `studio` services. PostgREST silently caps any query to that
limit unless the URL pins an explicit `&limit=…`. With `order=posted_on.asc`,
*the most recent rows are dropped first* — exactly the rows users care about.

Every snapshot fetch in `app/(site)/jobbmarked/page.tsx` therefore pins a
limit comfortably above its realistic ceiling:

```ts
"/snapshot_daily?order=posted_on.asc&limit=20000"
"/snapshot_skill_category_daily?order=posted_on.asc&limit=200000"
"/snapshot_geography?order=ai_count_30d.desc&limit=200"
"/taxonomy_categories?…&limit=500"
```

`/oppstart` follows the same pattern (`&limit=200000` on
`brreg_snapshot_daily`). When in doubt, copy that file.

## Client-side bucketing

`app/(site)/jobbmarked/_components/scroller.tsx` slices the per-day snapshots
client-side using helpers from `app/(site)/_lib/range.ts`:

- `parseRange(searchParams.get("range"))` → `"1m" | "1q" | "1y" | "max"`
- `rangeCutoffMs(range, nowMs)` → drop rows older than the cutoff
- `shouldBucketMonthly(range)` → daily for 1m/1q, monthly for 1y/max
- `dateKey(iso, monthly)` → `YYYY-MM-DD` or `YYYY-MM` bucket key

`nowMs` is derived from the latest `posted_on` across `snapshot_daily` and
`snapshot_skill_category_daily` — *not* `Date.now()` — so the cutoff is
stable across renders and tracks the data, not the wall clock.

The toggle updates the URL via `window.history.replaceState`, **never**
`router.replace`, so the snap-scroll container's scroll position is not
perturbed. See the comment in `onRangeChange` for the why.

## Refresh cadence

All snapshot RPCs run inside `refresh_all_snapshots()`
([0027_snapshot_categories_daily.sql:86–98](../supabase/migrations/0027_snapshot_categories_daily.sql)),
fired by `kiba-fetcher` at 04:00 server time
([scripts/fetcher-crontab](../scripts/fetcher-crontab)). The page revalidates
every 60 s (ISR), so the live site is at most 60 s stale on top of the daily
snapshot.

If the hero suddenly stops matching segment 2, check
`/admin/processes` for a failed `refresh_snapshot_daily` — that's the most
likely culprit. Manual trigger:

```sql
select public.refresh_snapshot_daily();
select public.refresh_snapshot_headline();
```

## Pitfalls we have already hit

### PR #106 — wrong source for the AI-share chart

The AI-share rewrite (`d1912cf`) drove segment 2 from
`snapshot_category_daily` instead of `snapshot_daily`. That table requires
`category is not null` (Tier 2 enrichment), so the chart undercounted both
numerator and denominator and the X-axis collapsed to whatever sparse dates
had any classified posting. Hero showed 399; chart summed to ~30 over only
6 days. Fix: read `snapshot_daily` directly. Documented here so we don't
relapse.

### Truncation drops *recent* rows, not old ones

`order=posted_on.asc` + 1000-row cap = the last 3 years of history go
missing first. If you see a chart that ends in 2023 on a fresh deploy,
`&limit=` is the answer.

### `total_count` semantics differ between snapshots

- `snapshot_daily.total_count` = all NAV postings that day (the denominator
  the hero uses).
- `snapshot_category_daily.total_count` = postings *in that category* that
  day (only summable into all-postings if you also have every category and
  no enrichment lag — i.e. never).
- `snapshot_geography.total_count_30d` = postings in that county over the
  last 30 days (a different rolling-window aggregate again).

Read the migration before summing across rows of any `*_count` column.

## Files

- [app/(site)/jobbmarked/page.tsx](../app/(site)/jobbmarked/page.tsx) — server-side data fetch
- [app/(site)/jobbmarked/_components/scroller.tsx](../app/(site)/jobbmarked/_components/scroller.tsx) — client-side bucketing + segment layout
- [app/(site)/_components/ai-share-area-chart.tsx](../app/(site)/_components/ai-share-area-chart.tsx) — segment 2 chart
- [app/(site)/_components/stacked-area-chart.tsx](../app/(site)/_components/stacked-area-chart.tsx) — segment 3 chart (with `normalize` prop)
- [app/(site)/_lib/range.ts](../app/(site)/_lib/range.ts) — shared cutoff/bucket helpers
- [supabase/migrations/0008_nav_snapshots.sql](../supabase/migrations/0008_nav_snapshots.sql) — `snapshot_daily`, `snapshot_monthly`, `snapshot_headline`, `snapshot_geography`
- [supabase/migrations/0027_snapshot_categories_daily.sql](../supabase/migrations/0027_snapshot_categories_daily.sql) — `snapshot_category_daily`, `snapshot_skill_category_daily`, the `refresh_all_snapshots()` orchestrator