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

**Re-deploy admin code without restarting the pod:**
```bash
docker restart kiba-admin
```
(Bind-mounts pick up edits to `scripts/admin-server.js` immediately; only the
running process needs a kick.)
