# local-dev

Spin up the full kibarometer pod (Supabase fleet + Redis + admin stub) on
your laptop. Mirrors the VPS topology so anything that works here works
there.

```bash
./local-dev/setup.sh           # bring up (idempotent)
./local-dev/setup.sh down      # stop, keep data
./local-dev/setup.sh wipe      # stop + delete local-dev/data/
```

**After bring-up:**
- Admin stub: <http://localhost:4000/admin/health> (Phase 1; full login arrives in Phase 3)
- Supabase Studio: <http://localhost:8000> (Basic auth — see `local-dev/.env` for `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`)
- Postgres: `localhost:5432` (user `postgres`, password in `local-dev/.env`)

**Generated files** (all gitignored):
- `local-dev/.env` — minted secrets
- `local-dev/env/admin.env` — derived admin env
- `local-dev/data/postgres/` — Postgres PGDATA
- `docker/supabase/volumes/` — fetched from upstream supabase repo on first run

**Re-deploy admin code:**
The admin lives inside `kiba-web` (Next.js). In local dev, run it via
`pnpm dev` from the repo root — Next.js's HMR picks up edits without
restart. The supabase fleet started by this script provides Postgres /
GoTrue / PostgREST that `pnpm dev` connects to via `.env.local`.
