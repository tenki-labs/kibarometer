#!/usr/bin/env bash
# scripts/bootstrap.sh — one-time provisioning on the existing Tenki VPS.
# Skips global steps (Docker, UFW, deploy user) since tenki already set them.
# Run as root via sudo.
#
# Two phases (both idempotent):
#   1. (default)   create dirs + create the kiba Docker network.
#                  After this you populate /opt/kibarometer/env/ via
#                  scripts/generate-secrets.sh, then scp the compose files
#                  into /opt/kibarometer/website/.
#   2. (--bring-up) start the supabase fleet for the first time.
#                  deploy.sh's selective `up -d web admin` won't start
#                  auth/rest/etc. on its own — bootstrap is what makes the
#                  fleet exist before any code deploy happens.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then echo "run as root"; exit 1; fi

ROOT=/opt/kibarometer
PHASE="${1:-init}"

echo "== create dirs =="
install -d -o deploy -g deploy \
  "$ROOT/website" "$ROOT/website/docker/supabase" \
  "$ROOT/admin" "$ROOT/admin/sections" "$ROOT/admin/nav" \
  "$ROOT/env" \
  "$ROOT/data/postgres" \
  "$ROOT/backups" "$ROOT/build" "$ROOT/incoming"
# Storage bind-mount intentionally absent — Supabase Storage was stripped
# in Phase 0.5.

echo "== create kiba network =="
docker network inspect kiba >/dev/null 2>&1 || docker network create kiba

echo "== hydrate upstream supabase volumes =="
# The upstream supabase compose bind-mounts kong.yml + db init scripts from
# ./volumes/, which are gitignored. If the files don't exist, Docker silently
# creates empty directories at the source paths and bind-mounts THOSE — then
# Postgres/Kong try to source them as files and crash. Fetch them from the
# upstream supabase repo at master (idempotent — skips files that already
# exist with non-zero size).
SUPA_RAW="https://raw.githubusercontent.com/supabase/supabase/master/docker/volumes"
SUPA_FILES=(
  "api/kong.yml"
  "api/kong-entrypoint.sh"
  "db/realtime.sql"
  "db/webhooks.sql"
  "db/roles.sql"
  "db/jwt.sql"
  "db/_supabase.sql"
  "db/logs.sql"
  "db/pooler.sql"
)
VOL=$ROOT/website/docker/supabase/volumes
for f in "${SUPA_FILES[@]}"; do
  dest="$VOL/$f"
  if [ -f "$dest" ] && [ -s "$dest" ]; then continue; fi
  # Wipe whatever stub Docker might have created (empty dir or zero-byte file).
  rm -rf "$dest"
  install -d -o deploy -g deploy "$(dirname "$dest")"
  curl -fsSL "$SUPA_RAW/$f" -o "$dest"
  chown deploy:deploy "$dest"
done
chmod +x "$VOL/api/kong-entrypoint.sh" 2>/dev/null || true

echo "== symlink website/volumes -> docker/supabase/volumes =="
# Compose v2 resolves `./volumes/...` in the supabase compose against the
# CURRENT WORKING DIRECTORY at compose-time, not the compose file's own dir.
# We run compose from $ROOT/website/, so `./volumes/api/kong.yml` becomes
# $ROOT/website/volumes/api/kong.yml. The actual files are at
# $ROOT/website/docker/supabase/volumes/. Symlinking makes both paths work.
if [ ! -e "$ROOT/website/volumes" ]; then
  ln -s docker/supabase/volumes "$ROOT/website/volumes"
fi

if [[ "$PHASE" != "--bring-up" ]]; then
  cat <<'NOTE'

== init phase done ==

Next steps (on this VPS, as the deploy user where noted):

1. Mint secrets + drop env files:
     sudo bash /opt/kibarometer/incoming/scripts/generate-secrets.sh
   This writes /opt/kibarometer/env/{supabase,admin,fetcher}.env and
   .env.production (mode 600 owner deploy:deploy). Re-run safe — it
   refuses to overwrite existing files.

2. (One-time, on first deploy only) Stage the compose files:
     scp -r kibarometer/{compose.yml,compose.boot.yml,compose.prod.yml,docker/supabase/docker-compose.yml} \
       deploy@193.200.238.120:/opt/kibarometer/website/
   (deploy.sh — Phase 8 — handles this on every subsequent push.)

3. Re-run this script with --bring-up to start the supabase fleet:
     sudo bash /opt/kibarometer/incoming/scripts/bootstrap.sh --bring-up

4. (One-time) Mint the first super_admin via SQL — see
   docs/vps-bootstrap.md §6.

5. Add GitHub secrets in the kibarometer repo (for Phase 8 deploy):
     SSH_PRIVATE_KEY, SSH_KNOWN_HOSTS, VPS_HOST=193.200.238.120, VPS_USER=deploy

6. Push to main → Phase 8 CI builds web + admin and rolls them in.
NOTE
  exit 0
fi

# --bring-up phase
echo "== validate compose files present =="
for f in compose.yml compose.boot.yml compose.prod.yml docker/supabase/docker-compose.yml; do
  [[ -f "$ROOT/website/$f" ]] || { echo "missing $ROOT/website/$f — see init step 2"; exit 1; }
done
[[ -f "$ROOT/env/supabase.env" ]] || { echo "missing $ROOT/env/supabase.env — run generate-secrets.sh first"; exit 1; }

echo "== bring up supabase fleet (no web/admin yet — those need a built image) =="
cd "$ROOT/website"
# compose.boot.yml MUST be in the file list even though we're only starting
# supabase services, because compose validates the entire merged config and
# `fetcher` (in compose.yml) has `depends_on: admin` which is defined in
# compose.boot.yml.
docker compose --env-file "$ROOT/env/supabase.env" \
  -f compose.yml -f docker/supabase/docker-compose.yml \
  -f compose.prod.yml -f compose.boot.yml \
  up -d db kong auth rest meta studio

echo "== wait for kong healthy =="
for i in $(seq 1 30); do
  if docker inspect kiba-supabase-kong --format '{{.State.Health.Status}}' 2>/dev/null | grep -q healthy; then
    echo "kong healthy after ${i}x2s"; break
  fi
  sleep 2
done

# Same gotrue cold-boot quirk as local-dev: internal migrations sometimes
# silently no-op on first start (race with db readiness). Restarting once
# db is healthy fixes it. Without this: login fails with
# "column users.banned_until does not exist".
echo "== restart kiba-supabase-auth to force its internal migrations =="
docker restart kiba-supabase-auth >/dev/null
for _ in $(seq 1 30); do
  state=$(docker inspect -f '{{.State.Health.Status}}' kiba-supabase-auth 2>/dev/null || echo "unknown")
  if [ "$state" = "healthy" ]; then echo "kiba-supabase-auth healthy."; break; fi
  sleep 1
done

echo
echo "== bring-up done =="
echo "Push to main now → CI builds web + admin and deploy.sh's selective"
echo "up -d will refresh them. The 6-service supabase fleet stays running"
echo "across deploys."
