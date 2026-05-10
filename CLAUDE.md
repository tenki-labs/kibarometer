# CLAUDE.md — kibarometer playbook

You are working in **`tenki-labs/kibarometer`**, the repo for kibarometer.no.
Read this top-to-bottom on a cold start. Kibarometer is one platform with
**three independent data pipelines** — see §2 before diving into any pillar.

## 1. Mission

Track how AI is reshaping Norwegian working life, news coverage, and
company formation. Three independent pipelines feed one platform: NAV's
job feed, scrapegraphai-extracted articles from Norwegian news outlets,
and Brønnøysundregistrene's enterprise registry. We run our own analysis
and publish cite-able pages and JSON for journalists.

## 2. The three pillars

Kibarometer is one platform, three independent data pipelines. Each
pillar owns its own tables, snapshots, admin section, and cron prefix;
they share the LLM stack, the admin shell, and the marketing site.

| Pillar         | Source                                                      | Public      | Admin             | Cron prefix                |
| -------------- | ----------------------------------------------------------- | ----------- | ----------------- | -------------------------- |
| Jobbmarked     | NAV stillingsfeed                                           | /jobbmarked | /admin/job-market | backfill/enrich-nav, llm-* |
| Medie-dekning  | scrapegraphai via `kiba-scraper` (+ RSS for legacy sources) | /media      | /admin/media      | media-*                    |
| Oppstart       | Brønnøysundregistrene                                       | /oppstart   | /admin/startups   | brreg-*                    |

**Shared LLM pattern.** Each pillar runs the same two-stage pipeline
against the external MLX endpoint (Gemma 3 4B-IT 4-bit at `mlx.tenki.no`):

- **Tier 1 (discovery)** — relevance confirmation + verbatim AI-phrase
  extraction. K≈15 rows per tick, ~3 s/call, ~45 s budget.
- **Tier 2 (classification)** — assigns the pillar's taxonomy slug, plus
  (media only) stance + intensity. K≈4 rows per tick, ~12 s/call.

Tier ticks across pillars are offset to keep the single Mac mini from
seeing overlapping calls — see [scripts/fetcher-crontab](scripts/fetcher-crontab)
for the exact schedule. All Tier jobs no-op silently when `MLX_API_KEY`
is unset.

**Public docs.** Per-pillar methodology lives at `/docs/jobbmarked`,
`/docs/media`, and `/docs/oppstart`, plus `/docs/nokkelord` (taxonomy)
and `/docs/api` (JSON snippets) — five cards on `/docs/`. Prose for the
three per-pipeline doc pages is editable from `/admin/content/<slug>`
(see §7).

## 3. Hard rules (do not negotiate)

1. **Idempotent migrations.** Numbered `00NN_name.sql`. `create table if not
   exists`, `drop policy if exists` before `create policy`, `on conflict do
   nothing` on inserts. Never rewrite an applied migration — add a new one.
2. **PRG (POST-Redirect-GET) on every form.** Server actions / POST handlers
   redirect on success. Never return HTML from a POST.
3. **Conventional Commits.** `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`,
   `style:`, `test:`. Sign Claude-authored commits with
   `Co-Authored-By: Claude <noreply@anthropic.com>`.
4. **Never `--no-verify`, never force-push to `main`, never push without PR.**
5. **Forward motion over confirmation loops.** When direction is approved,
   make sensible defaults and announce them.

> Two earlier rules were retired in the Phase F redesign: *zero npm
> dependencies in the admin* and *server-rendered HTML in admin via
> tagged-template literals*. PR 4 ported the admin into `/admin/*` inside
> kiba-web (Next.js, shadcn/ui, server actions); the follow-up retirement
> deleted the legacy `scripts/admin-server.js` + `scripts/admin-sections/`
> + `scripts/nav/` and the `kiba-admin` container.

## 4. Current state

**Lives on:** Gigahost VPS `193.200.238.120` (shared with tenki.no).
**Domain:** `kibarometer.no` and `www.kibarometer.no` resolve to the VPS.
**Cert:** Let's Encrypt, issued by the shared edge Caddy.

**Containers we own (all on the `kiba` Docker network):**
- `kiba-web` — Next.js 16 standalone, serves marketing + `/admin/*` (built
  from [docker/web.Dockerfile](docker/web.Dockerfile)). Phase F PR 4 moved
  the admin (login, sidebar, jobs/keywords pages, server actions, and the
  bearer-authed `/admin/api/jobs/*` cron handlers) into this container.
- `kiba-supabase-{db,kong,auth,rest,meta,studio}` — 6 services, forked from
  upstream supabase/docker via [scripts/fork-supabase-compose.sh](scripts/fork-supabase-compose.sh).
  **Storage + imgproxy intentionally stripped** (Phase 0.5; CI guards via
  [.github/workflows/ci.yml](.github/workflows/ci.yml)).
- `kiba-scraper` — FastAPI sidecar (Python 3.13 + Playwright + scrapegraphai)
  and the backbone of the media pillar. Wraps `SearchGraph` (DuckDuckGo URL
  discovery) and `SmartScraperGraph` (LLM-driven article body extraction)
  against the external MLX endpoint. Three routes: `POST /discover`,
  `POST /extract`, `GET /healthz`. Built from
  [docker/scraper/Dockerfile](docker/scraper/Dockerfile) (~1 GB image —
  Chromium + Playwright + Python). Called from
  [lib/admin/legacy/media-scraper-client.js](lib/admin/legacy/media-scraper-client.js)
  by `media-backfill` (discovery, when `backfill_method='scrapegraph'` —
  the default since [0044](supabase/migrations/0044_scrapegraph_backfill_method.sql))
  and `media-fetch-classify` (body extraction for every queued URL,
  regardless of how the URL was discovered). The other three
  `backfill_method` values (`rss_only`, `sitemap`, `site_search`) remain
  available on `media_sources` for legacy outlets.
- `kiba-redis` — cache / rate-limit (declared but unused until a feature wires it).
- `kiba-fetcher` — alpine cron sidecar, hits `kiba-web`'s `/admin/api/jobs/*`.
  One container drives all three pillars (NAV / media / brreg) plus the
  shared Tier 1/Tier 2 ticks. Schedule and offsets are in
  [scripts/fetcher-crontab](scripts/fetcher-crontab); `brreg-bootstrap`
  and `brreg-roles-burst` are manual-only via `/admin/oppstart` and not on
  the cron.
- `kiba-backup` — alpine cron sidecar, nightly Postgres dump → Backblaze B2.
- `kiba-umami` — self-hosted visitor analytics (Phase G). Reads its own
  `umami` database inside `kiba-supabase-db` (provisioned by
  [0009_umami_db.sql](supabase/migrations/0009_umami_db.sql)). Tracker script
  exposed publicly via `/_umami/*` at the edge; admin UI is *not* routed
  publicly — first-time setup over `ssh -L 3001:kiba-umami:3000`. The
  /admin/analytics page reads its REST API server-side via
  [lib/admin/umami.ts](lib/admin/umami.ts).

**Shared on the VPS (NOT ours):**
- `edge-caddy-1` at `/opt/edge/` — read-only from our side, except we write
  `/opt/edge/sites/kibarometer.caddy` on every deploy. Edge joins the `kiba`
  network via `docker network connect` (idempotent, run by deploy.sh).
- **MLX endpoint** at `mlx.tenki.no` — OpenAI-compatible local LLM (Gemma 3
  4B-IT 4-bit on a Mac mini), shared with tenki. Consumed by `kiba-scraper`
  and `kiba-web` via `MLX_BASE_URL` / `MLX_API_KEY` / `MLX_MODEL`. Health
  tracked in `public.mlx_health`
  ([0020_mlx_health.sql](supabase/migrations/0020_mlx_health.sql)) and
  surfaced on `/admin/llm`. When `MLX_API_KEY` is unset, all Tier jobs
  no-op silently with a `no_api_key` label.
- tenki.no's containers (`tenki-web-1`, `tenki-admin-1`, `tenki-redis-1`,
  unforked `supabase-*` fleet on tenki's network). They do not share a
  network with us — see §5.

## 5. Architecture

- **Edge:** Caddy at `/opt/edge/`. Routing for kibarometer.no lives in
  `/opt/edge/sites/kibarometer.caddy`, synced from
  [docker/edge/sites/kibarometer.caddy](docker/edge/sites/kibarometer.caddy)
  on every deploy. We never touch `/opt/edge/Caddyfile`,
  `/opt/edge/compose.yml`, or `/opt/edge/data/`.
- **Admin (Next.js):** [app/admin/](app/admin/) — server components, server
  actions for forms, shadcn/ui Sidebar/Card/Table/etc. Auth gate is
  [middleware.ts](middleware.ts) (HS256 cookie verify, `runtime: "nodejs"`).
  Service-role PostgREST calls go through [lib/admin/sb.ts](lib/admin/sb.ts).
  Orchestration logic (NAV fetch / backfill / enrich / re-tag / snapshot
  refresh, plus the media and brreg equivalents) is reused from the legacy
  admin via copies under [lib/admin/legacy/](lib/admin/legacy/).
- **LLM stack.** Tier 1 + Tier 2 orchestrators in
  [lib/admin/llm-discover.ts](lib/admin/llm-discover.ts) and
  [lib/admin/llm-classify.ts](lib/admin/llm-classify.ts), with per-pillar
  variants ([lib/admin/llm-media-tier1.ts](lib/admin/llm-media-tier1.ts),
  [lib/admin/llm-media-tier2.ts](lib/admin/llm-media-tier2.ts),
  [lib/admin/llm-brreg-tier1.ts](lib/admin/llm-brreg-tier1.ts),
  [lib/admin/llm-brreg-tier2.ts](lib/admin/llm-brreg-tier2.ts)). MLX
  client in [lib/admin/mlx.ts](lib/admin/mlx.ts) handles health tracking
  and per-call retry. Active prompts live in `public.llm_prompts`
  (versioned) and are edited via `/admin/{job-market,media,startups}/prompts`.
- **Marketing Next.js:** [app/(site)/](app/(site)/) (server components by
  default), [lib/env.ts](lib/env.ts) (zod-validated env). Pillar pages
  live at `/jobbmarked`, `/media`, `/oppstart`; methodology at `/docs/*`.
- **Networks:** our containers are on the `kiba` network only. Edge-caddy
  joins `kiba` post-up so it can reach `kiba-supabase-kong` (the only ingress
  point). NOT on `edge_net` — joining edge_net would put `kiba-*` on the same
  network as tenki's `*-1` containers and risk alias collisions. See PR #11.
- **Service naming:** every service we own is `kiba-<name>`. The default
  service-name network alias must be the only alias — Compose's `aliases:`
  field is *additive*, so for `kiba-supabase-kong` we explicitly disconnect
  and reconnect with `--alias kiba-supabase-kong` in deploy.sh to drop the
  default `kong` alias that would otherwise shadow tenki's `kong`. See PR #12.
- **Supabase compose:** committed at
  [docker/supabase/docker-compose.yml](docker/supabase/docker-compose.yml).
  ALREADY rewritten by `scripts/fork-supabase-compose.sh` (container names,
  bind paths, storage/imgproxy stripped). Never re-lift the upstream without
  re-running the fork script — CI catches it.

## 6. Code conventions

- **Server components by default.** Add `"use client"` only when you need
  interactivity (`usePathname`, `useState`, etc.). Forms call server
  actions (`<form action={action}>`); never client fetch handlers.
- **PRG on every form.** Server actions redirect on success with a
  `?flash_ok=…` / `?flash_error=…` query string; the page renders that as a
  shadcn `Alert` via [`<Flash>`](app/admin/_components/flash.tsx). No
  client toast / sonner — keeps everything no-JS-friendly.
- **`sbFetch` from [lib/admin/sb.ts](lib/admin/sb.ts)** is the only
  PostgREST client in admin code. No `@supabase/supabase-js`. Pass
  `{ service: true }` for service-role.
- **shadcn/ui in [components/ui/](components/ui/)**. Add new primitives
  via the registry; don't hand-roll.
- **Auth in [middleware.ts](middleware.ts) + [lib/admin/auth.ts](lib/admin/auth.ts).**
  `runtime: "nodejs"` is required (Edge has no `node:crypto`). Server
  components/actions read claims via `getStaffClaims()`.
- **Cron handlers** under [app/admin/api/jobs/](app/admin/api/jobs/) —
  each declares `export const runtime = "nodejs"` and bearer-checks via
  `requireBearer` from [lib/admin/bearer.ts](lib/admin/bearer.ts).
- **Time-range vocabulary and bucket grain.** Public scrollers share a
  5-option `Range` (`1m | 6m | 1y | since-2024 | max`) defined in
  [app/(site)/_components/time-range-toggle.tsx](app/(site)/_components/time-range-toggle.tsx).
  Every range names a **trailing window ending at "now"** — "1m" = the
  most recent 30 days, never "the first 30 days of data". Each range
  has a canonical bucket grain (`day | week`) defined by
  `bucketGrainForRange` in [app/(site)/_lib/range.ts](app/(site)/_lib/range.ts).
  Don't fork either; extend the switch.
- **Conventional Commits.** Sign Claude-authored commits with
  `Co-Authored-By: Claude <noreply@anthropic.com>`.

## 7. How to add a section

1. Migration: `supabase/migrations/00NN_<name>.sql` (idempotent;
   `create table if not exists`, RLS, policies).
2. Add filename to the migration loop in [scripts/deploy.sh](scripts/deploy.sh).
3. Page: `app/admin/(app)/<name>/page.tsx` (server component, awaits
   `searchParams`, renders shadcn primitives).
4. Server actions: `app/admin/(app)/<name>/actions.ts` (`"use server"`,
   each action calls `sbFetch` and `redirect()` with a flash QS).
5. Add nav entry to `ADMIN_NAV` in [app/admin/_components/admin-nav.ts](app/admin/_components/admin-nav.ts) — pick **Drift**, **Jobbmarked**, **Medie-dekning**, **Oppstart**, **Data**, or **Nettside**, or add a new section.
6. Test locally (`./local-dev/setup.sh` + `pnpm dev`), commit, push.

**Editable static copy.** Prose for `/om`, `/media`, and
`/docs/{jobbmarked,media,oppstart}` lives in
[`public.site_content`](supabase/migrations/0011_site_content.sql), edited
via `/admin/content/<slug>`. Per-pipeline doc seeds were added in
[0043_site_content_docs.sql](supabase/migrations/0043_site_content_docs.sql);
[0045_metode_to_docs.sql](supabase/migrations/0045_metode_to_docs.sql)
retired `/metode` in favour of the per-pipeline `/docs/*` pages;
[0046_retire_mediedekning_content.sql](supabase/migrations/0046_retire_mediedekning_content.sql)
retired the `/mediedekning` row after PR #87 merged it into `/media`.
Saves call `revalidatePath("/<slug>")` so the live page re-renders on the
next request instead of waiting for the 60 s ISR window. Code-driven
sections (the keyword catalogue, API/embed snippets) stay in JSX —
`site_content` is for prose only.

## 8. Migrations

Idempotent only — they re-run on every deploy. 46 migrations live in
[supabase/migrations/](supabase/migrations/); numbering is sequential.
For destructive migrations, apply manually via psql once, then merge
dependent code.

```bash
ssh deploy@193.200.238.120
PGPW=$(grep '^POSTGRES_PASSWORD=' /opt/kibarometer/env/supabase.env | cut -d= -f2)
docker exec -i -e PGPASSWORD="$PGPW" kiba-supabase-db \
  psql -U postgres -d postgres < /opt/kibarometer/website/supabase/migrations/00NN_foo.sql
```

## 9. Deploy

`git push origin main` → GitHub Actions
([.github/workflows/deploy.yml](.github/workflows/deploy.yml)) → scp source
to `/opt/kibarometer/incoming/` → ssh runs
[scripts/deploy.sh](scripts/deploy.sh) on the VPS as `deploy`.

deploy.sh: builds the kiba-web image, syncs admin sources, applies
migrations, recreates `kiba-{web,fetcher,backup,redis,umami,scraper}` (NOT
the supabase fleet — that came up via `bootstrap.sh --bring-up`),
force-recreates `kong` (so the alias-strip step takes effect), syncs the
edge fragment, reloads Caddy, runs an external smoke test, archives the
build directory.

If the supabase fleet ever needs to come back up after `down`, re-run
`sudo bash /opt/kibarometer/incoming/scripts/bootstrap.sh --bring-up` on
the VPS (after a fresh push so `incoming/` has source).

## 10. Backups (Phase 9)

Nightly `pg_dump` from `kiba-supabase-db` → Backblaze B2, run by `kiba-backup`
at 03:00 server time. Sundays also write a weekly snapshot. See
[scripts/backup.sh](scripts/backup.sh).

- Bucket: `kibarometer-backups` (private, in B2).
- Creds in `/opt/kibarometer/env/backup.env` (mode 600 deploy:deploy).
  Stub generated by [scripts/generate-secrets.sh](scripts/generate-secrets.sh);
  the user fills in `B2_APPLICATION_KEY_ID` / `B2_APPLICATION_KEY` after
  creating a scoped application key in the Backblaze console.
- Optional `UPTIME_KUMA_HEARTBEAT_URL` for heartbeat pings (commented out
  by default).
- Manual trigger to verify: `docker exec kiba-backup /backup.sh`.
- Restore: `rclone copy b2:kibarometer-backups/nightly/<file>.dump .` then
  `pg_restore -d postgres -U postgres -c <file>.dump` against `kiba-supabase-db`.

## 11. Local dev

```bash
./local-dev/setup.sh         # up (supabase fleet + redis)
./local-dev/setup.sh down    # stop, keep data
./local-dev/setup.sh wipe    # reset
pnpm dev                     # the admin lives inside kiba-web
```

New admin at `http://localhost:3000/admin/login` (`me@local.test` /
`localdev123`). `setup.sh` writes the four admin secrets
(`SUPABASE_INTERNAL_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`,
`FETCHER_TOKEN`) into `.env.local` so `pnpm dev` picks them up; restart it
after the first `setup.sh` run.

## 12. Secrets

VPS only, mode 600 deploy:deploy:
```
/opt/kibarometer/env/supabase.env       # Postgres + GoTrue + JWT + dashboard
/opt/kibarometer/env/admin.env          # source of truth for JWT secret, anon/service keys, fetcher token, UMAMI_*, MLX_*
/opt/kibarometer/env/fetcher.env        # fetcher cron — admin URL + fetcher token (must match admin.env)
/opt/kibarometer/env/backup.env         # B2 creds, bucket, optional Kuma URL
/opt/kibarometer/env/umami.env          # Umami Postgres URL + HASH_SALT + APP_SECRET
/opt/kibarometer/env/.env.production    # kiba-web runtime env — propagated from admin.env by deploy.sh (FETCHER_TOKEN, SUPABASE_JWT_SECRET, UMAMI_*, MLX_*) plus marketing-only NEXT_PUBLIC_*
```

[scripts/generate-secrets.sh](scripts/generate-secrets.sh) mints all six on
a fresh VPS, refusing to clobber any existing file. Real B2 creds are NOT
generated — they come from the Backblaze console. Real Umami API key +
website ID are NOT generated either — they come from a one-time setup via
SSH-tunnel to the Umami container; see the `/admin/analytics` empty-state
card for the runbook. `MLX_*` values point at the shared `mlx.tenki.no`
endpoint and are issued by tenki — see §4.

## 13. Out of scope

- Don't push to `main` without PR.
- Don't `--no-verify` or force-push.
- Don't add npm deps to the admin.
- Don't modify `/opt/edge/Caddyfile`, `/opt/edge/compose.yml`, or
  `/opt/edge/data/` — those belong to the edge owner (tenki).
- Don't reuse tenki's secrets, paths, container names, or networks.
- Don't lift `docker/supabase/docker-compose.yml` from upstream without
  re-running [scripts/fork-supabase-compose.sh](scripts/fork-supabase-compose.sh)
  — CI catches it.
- Don't add storage or imgproxy back to the supabase compose without a
  product reason — they're stripped on purpose.
