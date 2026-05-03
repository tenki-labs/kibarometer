# Kibarometer V1 Implementation Plan

The work between today (Phases 0–9 done — infra, admin shell, raw NAV fetch, backups, SEO) and v1 launch (public dashboard with four views, methodology, about, JSON endpoints).

Five phases, A–E. Phases A and B can run in parallel. C depends on A. D depends on C. E depends on D.

The hard intellectual work is **Phase A** (the keyword taxonomy). Everything downstream is a function of that list.

---

## Product decisions

These decisions are baked into the rest of the plan:

1. **Headline = flow, not stock.** "AI-stillinger denne uken" counts postings *posted* in the last 7 days, not currently active. Matches the framing journalists use.
2. **Dated permalinks for the headline.** `snapshot_headline` is keyed by `computed_for date` and keeps full daily history. The dashboard accepts `?as_of=YYYY-MM-DD` to pin to a historical snapshot, so citations don't decay. Top-keywords / geography / category remain current-only with a visible "computed for" date stamp.
3. **Top-keywords default sort: 30d AI-count.** YoY % is a prominent column and the table re-sorts via `?sort=yoy` (server-rendered).
4. **"Sektor" → "Yrkeskategori".** NAV's `category` field is occupation, not industry. We render it as occupation and don't fabricate an industry mapping.
5. **Auto-generated headline sentence.** One line of prose above the big number, regenerated each refresh from the snapshot delta. Makes the page citeable as text, not just numbers.
6. **Sample-size warnings.** Rows with `<10` AI postings in the window render greyed-out with a "lavt utvalg" badge. Threshold lives as a single constant.
7. **GitHub issue template for keyword suggestions.** A `keyword-suggestion.yml` form at `.github/ISSUE_TEMPLATE/`, linked from `/metode`. Structured fields (term, language, category, sample posting URL, reasoning) beat free-form issues.
8. **Embed mode.** `?embed=headline` and `?embed=trend` strip nav/footer/background for iframing in articles. Big citation driver for ~30 lines of code.

---

## Phase A — Keyword taxonomy

The inclusion list, in EN + NO, plus the admin section to edit it.

### A.1 Migration `supabase/migrations/0006_keywords.sql`

```sql
create table if not exists public.keywords (
  id uuid primary key default gen_random_uuid(),
  term text not null,
  term_norm text generated always as (lower(term)) stored,
  language text not null check (language in ('no', 'en', 'any')),
  category text not null check (category in ('tool', 'role', 'concept')),
  match_type text not null default 'word'
    check (match_type in ('word', 'substring')),
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (term_norm, language)
);

create index if not exists keywords_active_idx
  on public.keywords (is_active, category) where is_active;

drop trigger if exists keywords_updated_at on public.keywords;
create trigger keywords_updated_at before update on public.keywords
  for each row execute function public.trigger_set_updated_at();

alter table public.keywords enable row level security;

drop policy if exists keywords_public_read on public.keywords;
create policy keywords_public_read on public.keywords
  for select using (is_active = true);
-- ^ public so the methodology page (anon key) can render the list.

drop policy if exists keywords_admin_read on public.keywords;
create policy keywords_admin_read on public.keywords
  for select using (public.is_staff());
-- ^ staff see soft-deleted entries too.

drop policy if exists keywords_admin_write on public.keywords;
create policy keywords_admin_write on public.keywords
  for all using (public.is_admin_or_super())
  with check (public.is_admin_or_super());

-- Seed: initial inclusion list. on conflict do nothing so re-runs are no-ops
-- and manual edits via admin survive subsequent deploys.
insert into public.keywords (term, language, category, match_type, notes) values
  -- TOOLS (language: any — tool names match across languages)
  ('PyTorch',            'any', 'tool',    'word',      null),
  ('TensorFlow',         'any', 'tool',    'word',      null),
  ('JAX',                'any', 'tool',    'word',      null),
  ('scikit-learn',       'any', 'tool',    'word',      null),
  ('Hugging Face',       'any', 'tool',    'substring', null),
  ('LangChain',          'any', 'tool',    'word',      null),
  ('LlamaIndex',         'any', 'tool',    'word',      null),
  ('OpenAI',             'any', 'tool',    'word',      null),
  ('Claude',             'any', 'tool',    'word',      'Anthropic. Word-boundary to avoid surnames.'),
  ('GPT-4',              'any', 'tool',    'substring', null),
  ('Gemini',             'any', 'tool',    'word',      null),
  ('Mistral',            'any', 'tool',    'word',      null),
  ('Llama',              'any', 'tool',    'word',      null),
  ('Stable Diffusion',   'any', 'tool',    'substring', null),
  ('MLflow',             'any', 'tool',    'word',      null),
  ('Vertex AI',          'any', 'tool',    'substring', null),
  ('Azure ML',           'any', 'tool',    'substring', null),
  ('SageMaker',          'any', 'tool',    'word',      null),
  ('Bedrock',            'any', 'tool',    'word',      'AWS Bedrock.'),
  ('Pinecone',           'any', 'tool',    'word',      null),
  ('Weaviate',           'any', 'tool',    'word',      null),
  ('Chroma',             'any', 'tool',    'word',      null),
  -- ROLES — English
  ('ML Engineer',                 'en',  'role',    'word', null),
  ('AI Engineer',                 'en',  'role',    'word', null),
  ('Machine Learning Engineer',   'en',  'role',    'word', null),
  ('Data Scientist',              'en',  'role',    'word', null),
  ('MLOps Engineer',              'en',  'role',    'word', null),
  ('AI Researcher',               'en',  'role',    'word', null),
  ('AI Product Manager',          'en',  'role',    'word', null),
  ('Prompt Engineer',             'en',  'role',    'word', null),
  ('Applied Scientist',           'en',  'role',    'word', null),
  -- ROLES — Norwegian
  ('Maskinlæringsingeniør',       'no',  'role',    'word', null),
  ('AI-ingeniør',                 'no',  'role',    'word', null),
  ('KI-ingeniør',                 'no',  'role',    'word', null),
  ('Dataforsker',                 'no',  'role',    'word', null),
  ('AI-forsker',                  'no',  'role',    'word', null),
  ('KI-forsker',                  'no',  'role',    'word', null),
  ('MLOps-ingeniør',              'no',  'role',    'word', null),
  ('AI-arkitekt',                 'no',  'role',    'word', null),
  ('KI-arkitekt',                 'no',  'role',    'word', null),
  -- CONCEPTS — English
  ('machine learning',         'en',  'concept', 'substring', null),
  ('artificial intelligence',  'en',  'concept', 'substring', null),
  ('deep learning',            'en',  'concept', 'substring', null),
  ('neural network',           'en',  'concept', 'substring', null),
  ('natural language processing', 'en', 'concept', 'substring', null),
  ('NLP',                      'en',  'concept', 'word',      'Risk: also "Neuro-Linguistic Programming". Monitor false positives.'),
  ('computer vision',          'en',  'concept', 'substring', null),
  ('large language model',     'en',  'concept', 'substring', null),
  ('LLM',                      'en',  'concept', 'word',      null),
  ('generative AI',            'en',  'concept', 'substring', null),
  ('transformer',              'en',  'concept', 'word',      'Risk: power transformers. Review FPs after first week.'),
  ('fine-tuning',              'en',  'concept', 'substring', null),
  ('foundation model',         'en',  'concept', 'substring', null),
  ('prompt engineering',       'en',  'concept', 'substring', null),
  ('reinforcement learning',   'en',  'concept', 'substring', null),
  ('RAG',                      'en',  'concept', 'word',      'Retrieval-Augmented Generation.'),
  ('AI',                       'en',  'concept', 'word',      'Bare acronym. Word-boundary essential — substring match would catch e.g. "MAIN", "PAID". Monitor FP rate weekly.'),
  ('ML',                       'en',  'concept', 'word',      'Bare acronym for machine learning. Also abbreviates milliliter, mailing list. Monitor — may need scoping to title field only if too noisy.'),
  -- CONCEPTS — Norwegian
  ('KI',                       'no',  'concept', 'word',      'Norsk forkortelse for kunstig intelligens. Word-boundary essential.'),
  ('maskinlæring',             'no',  'concept', 'substring', null),
  ('kunstig intelligens',      'no',  'concept', 'substring', null),
  ('dyp læring',               'no',  'concept', 'substring', null),
  ('nevralt nettverk',         'no',  'concept', 'substring', null),
  ('språkmodell',              'no',  'concept', 'substring', null),
  ('store språkmodeller',      'no',  'concept', 'substring', null),
  ('generativ AI',             'no',  'concept', 'substring', null),
  ('generativ KI',             'no',  'concept', 'substring', null),
  ('forsterkende læring',      'no',  'concept', 'substring', null)
on conflict (term_norm, language) do nothing;
```

**Bare-acronym handling.** `AI`, `KI`, `ML` are in the seed list with `match_type = 'word'`. Word-boundary regex (using `\b` on lowercase title+occupation+description) avoids matching inside unrelated tokens like "MAIN" or "PAID", but standalone occurrences of the acronyms remain ambiguous (e.g. `ML` also abbreviates milliliter / mailing list; `AI` could appear in non-AI contexts; `KI` is unambiguous in Norwegian job-posting context but worth confirming). Monitor false-positive rate in week 1 by sampling postings tagged only via these three terms — if noise is high, scope them to the title field only via a `match_scope` column extension.

### A.2 Admin section `scripts/admin-sections/keywords.js`

Following the existing pattern in `scripts/admin-sections/jobs.js`:

- `listInner({ sb })` — table grouped by category, with toggle-active button per row, edit/delete buttons, and an "Add new" form at the top of the page. Show count of postings tagged with each keyword (sub-select) once tagging exists in Phase C.
- `create({ sb, body })` — POST handler, validates term/language/category, inserts.
- `update({ sb, id, body })` — POST handler, supports renaming, switching match_type, toggling is_active.
- `delete({ sb, id })` — soft-delete via `is_active = false`. (Hard-delete deferred — would orphan `matched_keywords` arrays in `nav_postings`.)

Use the existing `btn()`, `pageHead()`, `parseFlash()`, `flashQs()` helpers from `shared.js`.

### A.3 Wire into admin

In `scripts/admin-server.js`:

```js
import * as Keywords from "./sections/keywords.js";

// Add to NAV
const NAV = [
  ["/admin", "Oversikt"],
  ["/admin/jobs", "Jobber"],
  ["/admin/keywords", "Nøkkelord"],
];

// Routes (auth-gated):
// GET  /admin/keywords            → Keywords.listInner
// POST /admin/keywords/create     → Keywords.create   → redirect with flash
// POST /admin/keywords/:id/update → Keywords.update   → redirect with flash
// POST /admin/keywords/:id/delete → Keywords.delete   → redirect with flash
```

### A.4 Update `scripts/deploy.sh`

Append `0006_keywords.sql` to the migration loop at line 80.

### A.5 Verification

Locally (`./local-dev/setup.sh`): visit `/admin/keywords`, see seeded list grouped by category, edit a row, soft-delete a row, confirm changes persist. Confirm anon read returns only `is_active = true` rows.

---

## Phase B — Historical backfill

Walk NAV's `pam-stilling-feed` backwards/forwards until we have ~3 years of `nav_raw`. Independent of Phase A — can run in parallel.

### B.1 Cursor state

The simplest approach: use the existing `jobs` table to track backfill progress. Add a `metadata jsonb` column (idempotent `add column if not exists`) so backfill jobs can persist `last_cursor` and `oldest_event_at` between batches.

Migration `supabase/migrations/0006a_jobs_metadata.sql`:

```sql
alter table public.jobs add column if not exists metadata jsonb;
```

(Or fold this into 0006_keywords.sql — it's a small structural change.)

### B.2 `scripts/nav/client.js` — extend

Add `fetchStillingsfeedFirst()` and a `fetchStillingsfeedBatch({ cursor, maxPages })` that walks N pages forward from a cursor. NAV's feed is forward-only and event-sequential; the head endpoint returns the very first events. Strategy: start from `first`, walk forward in batches of ~50 pages (~5,000 events) per batch, store each page in `nav_raw`, advance cursor. Stop when oldest_event_at ≥ 3 years ago has been seen and we've caught up to the live cursor (i.e. an empty page).

The exact "first" endpoint shape needs to be confirmed against NAV's live API on first run — flag this as a 30-min discovery task before writing the loop. The `Authorization: Bearer` header logic in `client.js:16-25` already handles dynamic public-token rotation.

### B.3 Admin trigger + cron

- POST `/admin/api/jobs/backfill-nav` (bearer-authed) — runs one batch (≤50 pages or ≤60s wall time, whichever first), updates job.metadata.last_cursor, returns counts.
- Manual button on `/admin/jobs` ("Kjør backfill-batch") for visibility.
- Cron entry in `scripts/fetcher-crontab`:
  ```
  */15 * * * * curl -fsS -X POST -H "Authorization: Bearer ${FETCHER_TOKEN}" -m 90 ${ADMIN_URL}/admin/api/jobs/backfill-nav > /var/log/last-backfill.log 2>&1 || logger -s "kiba-fetcher: backfill-nav failed at $(date -Iseconds)"
  ```
  This catches up over a few hours/days and is a no-op once `metadata.completed = true`.

### B.4 Verification

- Trigger one batch manually, check `nav_raw` row count climbs by ~5,000.
- Check `jobs.metadata.last_cursor` advanced.
- Re-run — should resume from the saved cursor, not restart.
- After ~1 day of cron, oldest `payload->>'eventDate'` (or whichever field) in `nav_raw` should be ≥ 3 years old.

---

## Phase C — Normalization + tagging

Extract one row per posting into `nav_postings`, tag against the keyword list.

### C.1 Migration `supabase/migrations/0007_nav_postings.sql`

```sql
create table if not exists public.nav_postings (
  id text primary key,
  nav_raw_id uuid references public.nav_raw(id) on delete set null,
  title text,
  employer_name text,
  description text,
  location_municipality text,
  location_county text,
  location_country text default 'NO',
  category text,
  occupation text,
  posted_at timestamptz,
  expires_at timestamptz,
  apply_url text,
  source_url text,
  is_ai boolean not null default false,
  matched_keywords text[] not null default '{}',
  ingested_at timestamptz not null default now(),
  retagged_at timestamptz,
  payload jsonb
);

create index if not exists nav_postings_posted_at_idx
  on public.nav_postings (posted_at desc);
create index if not exists nav_postings_is_ai_posted_at_idx
  on public.nav_postings (posted_at desc) where is_ai;
create index if not exists nav_postings_keywords_gin
  on public.nav_postings using gin (matched_keywords);
create index if not exists nav_postings_county_idx
  on public.nav_postings (location_county) where is_ai;

alter table public.nav_postings enable row level security;

drop policy if exists nav_postings_public_read on public.nav_postings;
create policy nav_postings_public_read on public.nav_postings
  for select using (true);
-- ^ public read; the dashboard mostly uses snapshots but this enables ad-hoc queries.
```

The exact column list will be tightened after inspecting one real `nav_raw.payload` on the VPS — payload shape was deferred per `0002_nav_raw.sql:2-4` ("decided in Phase 8 once we've seen real production payloads"). **Precondition: ssh in and `select payload from nav_raw limit 1` before writing this migration.**

### C.2 `scripts/nav/processor.js`

Pure-function module, zero deps:

- `extractFromEvent(eventItem) → { id, title, employer_name, description, ... }` — pulls fields out of a single feed item.
- `compileMatchers(keywords) → [{ term, language, regex }]` — pre-compiles word-boundary regex per keyword (or substring `includes()` for `match_type = 'substring'`). Norwegian word boundaries handle `æ ø å` correctly via Unicode `\p{L}`.
- `applyTags(postingText, matchers) → { is_ai, matched_keywords[] }` — scans concatenated `title + ' ' + occupation + ' ' + description` (lowercased), returns array of matched terms.
- `processPayload({ sb, navRawRow, matchers }) → { processed }` — for each `payload.items[]`, extract → tag → upsert into `nav_postings`. Idempotent on `id` conflict.

### C.3 Wire into fetch

Modify `scripts/admin-sections/jobs.js::fetchNav()` to inline-process after writing `nav_raw`:

```js
// After the existing nav_raw insert:
const matchers = compileMatchers(await loadActiveKeywords(sb));
const upsertCount = await processPayload({ sb, navRawRow: { id, payload }, matchers });
// rows_processed becomes upsertCount instead of items.length
```

Same path used by both manual fetch, cron fetch, and backfill batches — single processing function, three callers.

### C.4 Reprocess admin action

When the user edits the keyword list, existing `nav_postings` rows have stale tags. Need a "reprocess all" button.

- POST `/admin/api/jobs/reprocess` (bearer-authed) — loads all active keywords, recompiles matchers, reads `nav_postings` in batches of 1000, recomputes `is_ai` + `matched_keywords` from `payload`, PATCHes back, sets `retagged_at`.
- Manual button on the Keywords page: "Re-tag alle stillinger" with confirm dialog.
- Cron: not needed — only run on demand.

### C.5 Optional admin browser

`scripts/admin-sections/postings.js` — read-only list view with filters (is_ai, county, posted_at range, matched_keywords contains). Useful for spot-checking the tagger. Nice-to-have, not blocking.

### C.6 Verification

- After one fetch run, `nav_postings` should have rows with sensible `title`, `posted_at`, etc.
- Spot-check `matched_keywords` arrays against postings you can read manually.
- Toggle a keyword's `is_active`, run "Re-tag alle stillinger", confirm `matched_keywords` arrays updated.
- Check `count(*) filter (where is_ai)` is plausible (small single-digit % of total in Norway, based on what we know).

---

## Phase D — Aggregation snapshots

Pre-computed dashboard views. One nightly job, all of it.

### D.1 Migration `supabase/migrations/0008_nav_snapshots.sql`

Five snapshot tables:

```sql
create table if not exists public.snapshot_daily (
  posted_on date primary key,
  ai_count int not null,
  total_count int not null
);

create table if not exists public.snapshot_monthly (
  posted_month date primary key,
  ai_count int not null,
  total_count int not null
);

create table if not exists public.snapshot_keywords (
  keyword text primary key,
  ai_count_30d int not null,
  ai_count_30d_yoy int not null,
  yoy_growth_pct numeric,         -- null when prior-window count is 0; UI shows "ny"
  rank int not null               -- by ai_count_30d desc; default sort
);

create table if not exists public.snapshot_geography (
  county text primary key,
  ai_count_30d int not null,
  total_count_30d int not null
);

create table if not exists public.snapshot_category (
  category text primary key,
  ai_count_30d int not null,
  total_count_30d int not null
);

create table if not exists public.snapshot_headline (
  computed_for date primary key,         -- one row per day; full history retained
  computed_at timestamptz not null,
  ai_count_7d int not null,              -- AI postings posted in last 7 days (flow, not stock)
  ai_count_30d int not null,
  ai_count_prev_30d int not null,        -- prior 30d window, for the auto-generated headline sentence
  ai_share_30d numeric(6,5) not null
);
```

Public-read RLS on all six (the marketing site uses anon key).

**History retention.** Only `snapshot_headline` and `snapshot_monthly` retain history (one row per day and one row per month, respectively). The other three (`snapshot_keywords`, `snapshot_geography`, `snapshot_category`) are recomputed from scratch each refresh — citation stability for those comes from the visible `computed_at` date stamp on the dashboard, not from URL pinning. This keeps the data footprint small (~one row/day for headline ≈ 1 KB/day; trend table ≈ 36 rows steady-state) while still supporting `?as_of=` permalinks for the headline number.

Plus six `refresh_snapshot_*()` SQL functions and one `refresh_all_snapshots()` orchestrator, defined in the same migration as `security definer`. The headline refresh upserts on `computed_for` so re-running the same day is idempotent:

```sql
create or replace function public.refresh_snapshot_headline() returns void
language sql security definer set search_path = public as $$
  insert into public.snapshot_headline (
    computed_for, computed_at,
    ai_count_7d, ai_count_30d, ai_count_prev_30d, ai_share_30d
  )
  select
    current_date,
    now(),
    count(*) filter (where is_ai and posted_at >= now() - interval '7 days'),
    count(*) filter (where is_ai and posted_at >= now() - interval '30 days'),
    count(*) filter (where is_ai
                       and posted_at >= now() - interval '60 days'
                       and posted_at <  now() - interval '30 days'),
    case when count(*) filter (where posted_at >= now() - interval '30 days') = 0
         then 0
         else (count(*) filter (where is_ai and posted_at >= now() - interval '30 days'))::numeric
            / count(*) filter (where posted_at >= now() - interval '30 days')
    end
  from public.nav_postings
  on conflict (computed_for) do update set
    computed_at        = excluded.computed_at,
    ai_count_7d        = excluded.ai_count_7d,
    ai_count_30d       = excluded.ai_count_30d,
    ai_count_prev_30d  = excluded.ai_count_prev_30d,
    ai_share_30d       = excluded.ai_share_30d;
$$;
```

The other five refresh functions follow the same shape (truncate-then-insert for the recomputed-each-refresh tables; `snapshot_monthly` upserts on `posted_month`).

### D.2 Refresh job

PostgREST exposes SQL functions at `/rpc/<name>`, so the admin calls:

```js
await sb('/rpc/refresh_all_snapshots', { service: true, method: 'POST' });
```

- POST `/admin/api/jobs/refresh-snapshots` (bearer-authed) — calls the RPC, logs to `jobs`.
- Manual button on Jobs page.
- Cron in `scripts/fetcher-crontab`:
  ```
  0 4 * * * curl ... /admin/api/jobs/refresh-snapshots
  ```
  At 04:00, after the 03:00 backup.

### D.3 Verification

- Run refresh manually, query each `snapshot_*` table, sanity-check shapes.
- Headline row for today exists: `select * from snapshot_headline where computed_for = current_date`.
- Re-run the refresh — same `computed_for` row updates in place (no duplicate-key error). Confirms the upsert path.
- After several days of cron runs, `select count(*) from snapshot_headline` grows by one per day.
- 36 rows in `snapshot_monthly` (steady state).
- `select * from snapshot_keywords order by yoy_growth_pct desc nulls last limit 5` returns the fastest-growing keywords; spot-check against raw counts.

---

## Phase E — Public surface

The site itself.

### E.1 Server-side Supabase helper

`lib/supabase.ts`:

```ts
import { env } from "./env";

export async function sb<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${env.SUPABASE_INTERNAL_URL}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    next: { revalidate: 60 }, // 1-min ISR
  });
  if (!res.ok) throw new Error(`PostgREST ${path} → ${res.status}`);
  return res.json();
}
```

Server-only — uses the internal Kong URL, not the public one. Anon key is fine for snapshot reads (public RLS).

### E.2 Charts

Hand-rolled SVG, server-rendered. Zero client deps for v1. Components in `app/_components/charts.tsx`:

- `<Sparkline values={number[]} />` — 30-point inline SVG, ~30 lines.
- `<TrendChart monthly={SnapshotMonthly[]} mode="absolute"|"share" />` — 36-point line chart with axes. URL param `?trend=share` toggles via server re-render.
- `<HBarList rows={{ label, value, total? }[]} />` — horizontal bars for top-keywords, geo, sector.

If a charting library proves necessary later (interactive tooltips etc.), `uplot` (~40KB) is the minimum-pain swap. Not for v1.

### E.3 Dashboard `app/page.tsx`

Replaces the current placeholder. Server component. Reads URL params, fetches snapshots in parallel, and renders four sections.

**URL params:**

| Param | Values | Effect |
|-------|--------|--------|
| `as_of` | `YYYY-MM-DD` | Pin the headline to a historical snapshot. Falls back to most-recent if the date has no row. |
| `trend` | `share` (default `absolute`) | Toggle the trend chart between absolute count and share-of-all-postings. |
| `sort` | `yoy` (default `count`) | Re-sort the top-keywords table by YoY growth. |
| `embed` | `headline` \| `trend` | Strip chrome (see E.5). |

**Server reads:**

```ts
const today = new Date().toISOString().slice(0, 10);
const asOf = searchParams.as_of ?? today;

const [headline, monthly, daily, keywords, geography, category] = await Promise.all([
  // Pinned date or fall back to most recent.
  sb<SnapshotHeadline[]>(`/snapshot_headline?computed_for=lte.${asOf}&order=computed_for.desc&limit=1`),
  sb<SnapshotMonthly[]>("/snapshot_monthly?order=posted_month.asc"),
  sb<SnapshotDaily[]>("/snapshot_daily?order=posted_on.desc&limit=30"),
  sb<SnapshotKeyword[]>(
    searchParams.sort === "yoy"
      ? "/snapshot_keywords?order=yoy_growth_pct.desc.nullslast&limit=20"
      : "/snapshot_keywords?order=rank.asc&limit=20"
  ),
  sb<SnapshotGeography[]>("/snapshot_geography?order=ai_count_30d.desc"),
  sb<SnapshotCategory[]>("/snapshot_category?order=ai_count_30d.desc&limit=10"),
]);
```

**Headline strip:**
- Auto-generated insight sentence above the big number, via a `headlineSentence(headline)` helper:
  - Increase ≥ 5%: `"AI-relaterte stillinger økte X% sammenlignet med forrige 30 dager."`
  - Decrease ≥ 5%: `"AI-relaterte stillinger falt X% sammenlignet med forrige 30 dager."`
  - `|delta| < 5%`: `"AI-relaterte stillinger er omtrent uendret sammenlignet med forrige 30 dager."`
- Big number: `headline.ai_count_7d` ("AI-stillinger denne uken").
- 30-day sparkline next to it (from `daily`).
- Date stamp: `Sist oppdatert: <fmtDateTime(headline.computed_at)>`. When `?as_of` is set, also render `Historisk øyeblikksbilde for <as_of>` so users know they're on a pinned view.

**Trend section:**
- 36-month line chart from `monthly`, mode-switched by `?trend`.
- Tab toggle: `<a href="?trend=absolute">Antall</a>` / `<a href="?trend=share">Andel</a>` — both preserve other params via `mergeQs()`.

**Top-keywords section ("Top nøkkelord, siste 30 dager"):**
- Table: keyword, category badge, 30d AI-count, YoY %, link to `/metode#kw-<id>`.
- Column-header sort toggles: `<a href="?sort=count">Antall ↓</a>` and `<a href="?sort=yoy">YoY ↓</a>`. Default `count`.
- YoY % column shows `"ny"` when `yoy_growth_pct` is NULL (prior window had zero).

**Yrkeskategori + Geografi sections** (side-by-side desktop, stacked mobile):
- Section header reads **"Yrkeskategori"** (not "Sektor") — NAV's `category` field is occupation, not industry.
- Each renders as a horizontal-bar list (the `<HBarList>` from E.2).

**Sample-size warnings.** A single constant `LOW_SAMPLE_THRESHOLD = 10` lives in `app/_components/charts.tsx`. Any row in top-keywords / yrkeskategori / geografi where the AI-count is below the threshold renders at `opacity: 0.55` with a `<span class="badge">lavt utvalg</span>` next to the value. Prevents publishing stories like "AI-share in Finnmark: 14.3%" off `n=2`.

Mobile-first: the four sections stack vertically below 768px. Norwegian copy throughout.

### E.4 Methodology page `app/metode/page.tsx`

Server component. Fetches `keywords` via anon key (public read filters to `is_active = true`), groups by category, renders. Includes:

- Plain-language explainer of what "AI-related" means here.
- The full keyword list, grouped by tool/role/concept, with `notes` shown. Each row has an anchor `id="kw-<keyword-id>"` so the dashboard's top-keywords table can deep-link.
- Caveats: "transformer" can mean power transformers; bare-acronym FP risk for `AI`/`KI`/`ML`; sample-size warnings for low-volume regions; etc.
- "Foreslå et nøkkelord" CTA linking to `https://github.com/tenki-labs/kibarometer/issues/new?template=keyword-suggestion.yml`.
- Embed snippets: copy-paste iframe HTML for `/embed/headline` and `/embed/trend`.
- Link to GitHub repo + JSON API documentation (schemas of each `/api/v1/*` endpoint).

The methodology page reads from the database, so it can never drift from what's actually applied.

### E.5 Embed mode

`?embed=headline` and `?embed=trend` strip the dashboard down to a single component for iframing in articles — a citation driver for journalists.

- Stable URLs `/embed/headline` and `/embed/trend` (Next.js route group with its own minimal layout) for cleaner iframe `src` attributes. The query-param form (`/?embed=headline`) is also supported and resolves to the same thing.
- `app/embed/layout.tsx` — no top nav, no footer, transparent background, no padding. `viewport` meta sets a min-width sensible for iframes.
- The embedded view renders the requested component only, plus a small "kibarometer.no" wordmark in the corner (clickable, links to the full dashboard) so the source is always visible.
- Documented on `/metode` with copy-paste iframe snippets like:
  ```html
  <iframe src="https://kibarometer.no/embed/trend"
          width="100%" height="320" frameborder="0"
          title="Trend i AI-stillinger"></iframe>
  ```
- A new GitHub issue template `embed-bug.yml` is **not** in v1 — track via the regular issue tracker.

### E.6 About page `app/om/page.tsx`

Static. Tenki Labs as institutional backer, Oscar Westbye as named author, contact email, GitHub link.

### E.7 Top nav

Add to `app/layout.tsx` body: a thin top nav linking `/` (Dashbord), `/metode` (Metode), `/om` (Om), `/api/v1/headline` (API). Keep it narrow — we have one real page and two reference pages. The embed layout (E.5) has no nav.

### E.8 JSON endpoints `app/api/v1/*/route.ts`

Five route handlers, one per snapshot table:

```ts
// app/api/v1/headline/route.ts
import { sb } from "@/lib/supabase";

export async function GET() {
  const [row] = await sb<SnapshotHeadline[]>("/snapshot_headline?limit=1");
  return Response.json(row, {
    headers: {
      "Cache-Control": "public, max-age=60, s-maxage=60",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
```

Same shape for `/api/v1/trend`, `/api/v1/keywords`, `/api/v1/geography`, `/api/v1/category`. Document the schemas on the methodology page.

### E.9 Verification

- Locally: `pnpm dev`, visit `/`, see four views with real local data.
- Visit `/metode`, confirm keyword list matches `select * from public.keywords where is_active`.
- Visit `/om`, confirm static content.
- `curl localhost:3000/api/v1/headline | jq` returns valid JSON.
- Mobile viewport (Chrome devtools), confirm the dashboard stacks.
- Lighthouse (`pnpm lhci`) — performance ≥ 90, accessibility ≥ 95.
- Production smoke: after deploy, `curl https://kibarometer.no/api/v1/headline | jq` returns the live numbers.

---

## Sequencing & PRs

One PR per phase, in order. A and B can be reviewed in parallel but A merges first (B's smoke test benefits from being able to read keywords).

| PR | Phase | Migrations added | Files added |
|----|-------|------------------|-------------|
| #16 | A — taxonomy | `0006_keywords.sql` | `scripts/admin-sections/keywords.js`, admin-server changes, deploy.sh loop entry |
| #17 | B — backfill | `0006a_jobs_metadata.sql` (or fold into 0006) | `scripts/nav/client.js` extensions, admin endpoint, crontab entry |
| #18 | C — normalize+tag | `0007_nav_postings.sql` | `scripts/nav/processor.js`, jobs.js changes, reprocess endpoint |
| #19 | D — snapshots | `0008_nav_snapshots.sql` | refresh endpoint, crontab entry |
| #20 | E — public site | (none) | `app/page.tsx` rewrite, `app/metode/`, `app/om/`, `app/embed/`, `app/api/v1/*`, `lib/supabase.ts`, `app/_components/charts.tsx`, `.github/ISSUE_TEMPLATE/keyword-suggestion.yml` |

Total: 5 PRs, ~3–5 migrations, ~13–15 new files.

## Out of scope for v1

- English locale of the dashboard (Norwegian only at launch).
- Authenticated API tier / rate limiting (Redis is wired but not used — defer until traffic justifies it).
- Per-employer drilldown (interesting, but not in the four-views spec).
- Exporting CSV (JSON endpoints cover the citation use case).
- Comparing to non-AI roles as a control group (good v2 idea).
- Email alerts for journalists.
- Admin-side analytics on usage of the public API.
