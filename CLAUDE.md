# CLAUDE.md — kibarometer playbook

You are working in **`tenki-labs/kibarometer`**, the repo for kibarometer.no.
Read this top-to-bottom on a cold start. `scaffolding.md` was the build
blueprint for Phases 0–10; everything that matters at runtime is here.

## 1. Mission

Fetch labour-market data from NAV (the Norwegian Labour and Welfare
Administration), run our own analysis, publish it as cite-able pages and JSON
for journalists.

## 2. Hard rules (do not negotiate)

1. **Zero npm dependencies in the admin.** Node 22 builtins only
   (`node:http`, `node:crypto`, `node:url`, `node:fs/promises`, native `fetch`).
   The marketing Next.js side may have npm deps.
2. **Idempotent migrations.** Numbered `00NN_name.sql`. `create table if not
   exists`, `drop policy if exists` before `create policy`, `on conflict do
   nothing` on inserts. Never rewrite an applied migration — add a new one.
3. **Server-rendered HTML in admin.** Tagged-template literals (`` html`…` ``,
   `` rawHtml`…` ``). No React, no JSX in the admin Node server.
4. **PRG (POST-Redirect-GET) on every form.** POST handlers redirect on
   success. Never return HTML from a POST.
5. **Conventional Commits.** `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`,
   `style:`, `test:`. Sign Claude-authored commits with
   `Co-Authored-By: Claude <noreply@anthropic.com>`.
6. **Never `--no-verify`, never force-push to `main`, never push without PR.**
7. **Forward motion over confirmation loops.** When direction is approved,
   make sensible defaults and announce them.

## 3. Current state

**Lives on:** Gigahost VPS `193.200.238.120` (shared with tenki.no).
**Domain:** `kibarometer.no` and `www.kibarometer.no` resolve to the VPS.
**Cert:** Let's Encrypt, issued by the shared edge Caddy.

**Containers we own (all on the `kiba` Docker network):**
- `kiba-web` — Next.js 15 standalone (built from [docker/web.Dockerfile](docker/web.Dockerfile))
- `kiba-admin` — Node 22, zero npm deps ([scripts/admin-server.js](scripts/admin-server.js))
- `kiba-supabase-{db,kong,auth,rest,meta,studio}` — 6 services, forked from
  upstream supabase/docker via [scripts/fork-supabase-compose.sh](scripts/fork-supabase-compose.sh).
  **Storage + imgproxy intentionally stripped** (Phase 0.5; CI guards via
  [.github/workflows/ci.yml](.github/workflows/ci.yml)).
- `kiba-redis` — cache / rate-limit (declared but unused until a feature wires it)
- `kiba-fetcher` — alpine cron sidecar, hits `kiba-admin`'s `/admin/api/jobs/*`
- `kiba-backup` — alpine cron sidecar, nightly Postgres dump → Backblaze B2

**Shared on the VPS (NOT ours):**
- `edge-caddy-1` at `/opt/edge/` — read-only from our side, except we write
  `/opt/edge/sites/kibarometer.caddy` on every deploy. Edge joins the `kiba`
  network via `docker network connect` (idempotent, run by deploy.sh).
- tenki.no's containers (`tenki-web-1`, `tenki-admin-1`, `tenki-redis-1`,
  unforked `supabase-*` fleet on tenki's network). They do not share a
  network with us — see §6.

## 4. Architecture

- **Edge:** Caddy at `/opt/edge/`. Routing for kibarometer.no lives in
  `/opt/edge/sites/kibarometer.caddy`, synced from
  [docker/edge/sites/kibarometer.caddy](docker/edge/sites/kibarometer.caddy)
  on every deploy. We never touch `/opt/edge/Caddyfile`,
  `/opt/edge/compose.yml`, or `/opt/edge/data/`.
- **Admin Node:** zero-deps [scripts/admin-server.js](scripts/admin-server.js)
  + [scripts/admin-sections/*.js](scripts/admin-sections/). Server-rendered
  HTML via `` html`…` ``. JWT verified locally (HS256, no SDK round-trip).
- **Marketing Next.js:** [app/](app/) (server components by default),
  [lib/env.ts](lib/env.ts) (zod-validated env).
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

## 5. Code conventions

- **Zero npm deps in admin.** Node 22 builtins only.
- **ES modules.** Imports use `.js` extension.
- **Server-rendered HTML.** `` html`…` `` auto-escapes; `` rawHtml`…` ``
  doesn't. Never concatenate user input into HTML.
- **PRG on every form.** POSTs redirect on success; never return HTML from
  a POST.
- **`sbFetch(path, { token, service, method, body, prefer })`** is the only
  PostgREST client. No `@supabase/supabase-js` in admin.
- **`btn()` for every CTA** — see [scripts/admin-sections/shared.js](scripts/admin-sections/shared.js).
- **Conventional Commits.** Sign Claude-authored commits with
  `Co-Authored-By: Claude <noreply@anthropic.com>`.

## 6. How to add a section

1. Migration: `supabase/migrations/00NN_<name>.sql` (idempotent;
   `create table if not exists`, RLS, policies).
2. Add filename to the migration loop in [scripts/deploy.sh](scripts/deploy.sh).
3. Section file: `scripts/admin-sections/<name>.js` exporting `listInner`,
   `detailInner`, `create`, `update`, `delete`.
4. Import in [scripts/admin-server.js](scripts/admin-server.js) and add routes.
5. Add nav entry to the `NAV` constant in
   [scripts/admin-server.js](scripts/admin-server.js).
6. Test locally (`./local-dev/setup.sh`), commit, push.

## 7. Migrations

Idempotent only — they re-run on every deploy. Current set:
[supabase/migrations/](supabase/migrations/) (`0001_baseline.sql`,
`0002_nav_raw.sql`, `0005_jobs.sql`). For destructive migrations, apply
manually via psql once, then merge dependent code.

```bash
ssh deploy@193.200.238.120
PGPW=$(grep '^POSTGRES_PASSWORD=' /opt/kibarometer/env/supabase.env | cut -d= -f2)
docker exec -i -e PGPASSWORD="$PGPW" kiba-supabase-db \
  psql -U postgres -d postgres < /opt/kibarometer/website/supabase/migrations/00NN_foo.sql
```

## 8. Deploy

`git push origin main` → GitHub Actions
([.github/workflows/deploy.yml](.github/workflows/deploy.yml)) → scp source
to `/opt/kibarometer/incoming/` → ssh runs
[scripts/deploy.sh](scripts/deploy.sh) on the VPS as `deploy`.

deploy.sh: builds the kiba-web image, syncs admin sources, applies
migrations, recreates `kiba-{web,admin,fetcher,backup,redis}` (NOT the
supabase fleet — that came up via `bootstrap.sh --bring-up`), force-recreates
`kong` (so the alias-strip step takes effect), syncs the edge fragment,
reloads Caddy, runs an external smoke test, archives the build directory.

If the supabase fleet ever needs to come back up after `down`, re-run
`sudo bash /opt/kibarometer/incoming/scripts/bootstrap.sh --bring-up` on
the VPS (after a fresh push so `incoming/` has source).

## 9. Backups (Phase 9)

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

## 10. Local dev

```bash
./local-dev/setup.sh         # up
./local-dev/setup.sh down    # stop, keep data
./local-dev/setup.sh wipe    # reset
```

Admin at `http://localhost:4000/admin/login` (`me@local.test` / `localdev123`).

## 11. Secrets

VPS only, mode 600 deploy:deploy:
```
/opt/kibarometer/env/supabase.env       # Postgres + GoTrue + JWT + dashboard
/opt/kibarometer/env/admin.env          # admin Node — JWT secret, anon/service keys, fetcher token
/opt/kibarometer/env/fetcher.env        # fetcher cron — admin URL + fetcher token
/opt/kibarometer/env/backup.env         # B2 creds, bucket, optional Kuma URL
/opt/kibarometer/env/.env.production    # marketing Next.js — public anon key, supabase URL
```

[scripts/generate-secrets.sh](scripts/generate-secrets.sh) mints all five on
a fresh VPS, refusing to clobber any existing file. Real B2 creds are NOT
generated — they come from the Backblaze console.

## 12. Out of scope

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
