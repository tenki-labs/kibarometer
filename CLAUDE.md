# CLAUDE.md — kibarometer playbook (Phase 0 placeholder)

You are working in the `kibarometer` repo for **kibarometer.no**. This file is a
placeholder; the full playbook (architecture, deploy, conventions in detail)
lands after Phase 8. For now, read `scaffolding.md` (the build blueprint) and
`/home/owestbye/.claude/plans/read-scaffolding-md-i-vast-eagle.md` (the
implementation plan) on a cold start.

## Mission

Fetch labour-market data from NAV (the Norwegian Labour and Welfare
Administration), run our own analysis, publish it as cite-able pages and JSON
for journalists.

## Hard rules (do not negotiate — same as `scaffolding.md` §1)

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

## Stack at a glance

- **Public site**: Next.js 15 (Bokmål copy).
- **Admin**: zero-dep Node 22 server, server-rendered HTML, JWT-cookie auth
  against self-hosted Supabase.
- **Database**: self-hosted Supabase (Postgres + GoTrue + Kong + PostgREST +
  Studio + postgres-meta). Storage + imgproxy intentionally **not** included
  on day one.
- **Cache / rate-limit**: Redis.
- **NAV fetcher**: a `kiba-fetcher` cron sidecar that hits the admin's
  `/admin/api/jobs/*` endpoints — keeps the admin as the sole DB writer.
- **Edge**: shared Caddy at `/opt/edge/` on the existing Tenki VPS.
  We write **only** `/opt/edge/sites/kibarometer.caddy`.
- **VPS**: `193.200.238.120`, shared with `tenki.no`. We own
  `/opt/kibarometer/` and the `kiba` Docker network.

## Open scope

This file will grow as phases land. After Phase 8, replace this placeholder
with the full template from `scaffolding.md` §10.
