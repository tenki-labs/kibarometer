#!/usr/bin/env bash
# One-shot local-dev bring-up. Idempotent — safe to re-run.
# Generates secrets, brings up the stack, applies all migrations, creates a super_admin.
#
# Usage (from anywhere — script cd's to repo root):
#   ./local-dev/setup.sh
#
# Sub-commands:
#   ./local-dev/setup.sh down   # stop containers, keep data
#   ./local-dev/setup.sh wipe   # stop + nuke local-dev/data/
set -euo pipefail

cd "$(dirname "$0")/.."           # repo root
ROOT=$(pwd)
LOCAL=$ROOT/local-dev
ADMIN_EMAIL="${ADMIN_EMAIL:-me@local.test}"
ADMIN_PASS="${ADMIN_PASS:-localdev123}"
ADMIN_NAME="${ADMIN_NAME:-Local Admin}"

COMPOSE=(docker compose --env-file "$LOCAL/.env" -f docker/supabase/docker-compose.yml -f local-dev/compose.yml)

case "${1:-up}" in
  down)
    "${COMPOSE[@]}" down
    exit 0
    ;;
  wipe)
    "${COMPOSE[@]}" down -v || true
    rm -rf "$LOCAL/data"
    echo "Wiped $LOCAL/data."
    exit 0
    ;;
esac

echo "== 0. Hydrate docker/supabase/volumes/ config files (if missing) =="
# These config files are gitignored (see .gitignore: docker/supabase/volumes)
# but our forked docker-compose.yml expects them as bind-mount sources. Fetch
# them from the upstream supabase repo at master if absent or empty (Docker
# silently creates empty dirs as fallbacks for missing mounts).
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
fetched=0
for f in "${SUPA_FILES[@]}"; do
  dest="$ROOT/docker/supabase/volumes/$f"
  if [ -e "$dest" ] && [ ! -d "$dest" ] && [ -s "$dest" ]; then continue; fi
  [ -d "$dest" ] && rmdir "$dest" 2>/dev/null || rm -rf "$dest" 2>/dev/null || true
  mkdir -p "$(dirname "$dest")"
  echo "  fetching $f"
  curl -fsSL "$SUPA_RAW/$f" -o "$dest"
  fetched=$((fetched + 1))
done
chmod +x "$ROOT/docker/supabase/volumes/api/kong-entrypoint.sh" 2>/dev/null || true
[ "$fetched" -eq 0 ] && echo "  (all volumes config files already present)"

echo "== 1. Generate secrets (if not already present) =="
mkdir -p "$LOCAL/env" "$LOCAL/data/postgres"
chmod 700 "$LOCAL/env" 2>/dev/null || true

if [ ! -f "$LOCAL/.env" ]; then
  POSTGRES_PASSWORD=$(openssl rand -hex 16)
  JWT_SECRET=$(openssl rand -hex 32)
  DASHBOARD_PASSWORD=$(openssl rand -hex 12)
  SECRET_KEY_BASE=$(openssl rand -hex 32)
  VAULT_ENC_KEY=$(openssl rand -hex 16)
  PG_META_CRYPTO_KEY=$(openssl rand -hex 16)
  ANON_KEY=$(JWT_SECRET="$JWT_SECRET" node "$LOCAL/mint-jwt.mjs" anon)
  SERVICE_ROLE_KEY=$(JWT_SECRET="$JWT_SECRET" node "$LOCAL/mint-jwt.mjs" service_role)

  # Seed local-dev/.env from the supabase example, then patch the secrets.
  cp "$ROOT/docker/supabase/.env.example" "$LOCAL/.env"
  ed -s "$LOCAL/.env" <<EOF
,s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$POSTGRES_PASSWORD|
,s|^JWT_SECRET=.*|JWT_SECRET=$JWT_SECRET|
,s|^ANON_KEY=.*|ANON_KEY=$ANON_KEY|
,s|^SERVICE_ROLE_KEY=.*|SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY|
,s|^DASHBOARD_PASSWORD=.*|DASHBOARD_PASSWORD=$DASHBOARD_PASSWORD|
,s|^SECRET_KEY_BASE=.*|SECRET_KEY_BASE=$SECRET_KEY_BASE|
,s|^VAULT_ENC_KEY=.*|VAULT_ENC_KEY=$VAULT_ENC_KEY|
,s|^PG_META_CRYPTO_KEY=.*|PG_META_CRYPTO_KEY=$PG_META_CRYPTO_KEY|
,s|^ENABLE_EMAIL_AUTOCONFIRM=.*|ENABLE_EMAIL_AUTOCONFIRM=true|
,s|^DISABLE_SIGNUP=.*|DISABLE_SIGNUP=true|
w
q
EOF
  echo "  Generated $LOCAL/.env."
else
  echo "  $LOCAL/.env already exists — leaving it alone."
fi

# Always (re)derive admin.env from .env. Cheap, idempotent, and recovers
# from the case where .env exists but admin.env was lost.
if [ ! -f "$LOCAL/env/admin.env" ]; then
  ANON_KEY=$(grep -E '^ANON_KEY=' "$LOCAL/.env" | head -1 | cut -d= -f2-)
  SERVICE_ROLE_KEY=$(grep -E '^SERVICE_ROLE_KEY=' "$LOCAL/.env" | head -1 | cut -d= -f2-)
  JWT_SECRET=$(grep -E '^JWT_SECRET=' "$LOCAL/.env" | head -1 | cut -d= -f2-)
  cat > "$LOCAL/env/admin.env" <<EOF
PORT=4000
SUPABASE_INTERNAL_URL=http://kong:8000
SUPABASE_ANON_KEY=$ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
SUPABASE_JWT_SECRET=$JWT_SECRET
SUPABASE_EXTERNAL_URL=http://localhost:8000
PUBLIC_BASE_URL=http://localhost:4000
REDIS_URL=redis://redis:6379
EOF
  chmod 600 "$LOCAL/env/admin.env"
  echo "  Generated $LOCAL/env/admin.env from .env."
else
  echo "  $LOCAL/env/admin.env already exists — leaving it alone."
fi

# Compose needs the absolute repo path to expand ${KIBA_REPO_ROOT} in
# bind-mount sources. Persist it into .env so it survives sudo, cron, etc.
if grep -q '^KIBA_REPO_ROOT=' "$LOCAL/.env" 2>/dev/null; then
  sed -i "s|^KIBA_REPO_ROOT=.*|KIBA_REPO_ROOT=$ROOT|" "$LOCAL/.env"
else
  echo "KIBA_REPO_ROOT=$ROOT" >> "$LOCAL/.env"
fi

echo "== 2. docker compose up (db, kong, rest, auth, meta, studio, redis, admin) =="
"${COMPOSE[@]}" up -d db kong rest auth meta studio redis
# --force-recreate --no-deps on admin so bind-mount path changes take effect
# even if a previous failed-run container is sitting in 'restarting' state.
"${COMPOSE[@]}" up -d --force-recreate --no-deps admin

echo "== 3. Wait for db healthy =="
for _ in $(seq 1 60); do
  state=$(docker inspect -f '{{.State.Health.Status}}' kiba-supabase-db 2>/dev/null || echo "unknown")
  if [ "$state" = "healthy" ]; then echo "  db healthy."; break; fi
  sleep 1
done

# GoTrue ships internal migrations that sometimes silently no-op on a cold
# first boot (they race db readiness). A restart once db is healthy reliably
# runs them. Without this, login fails with:
#   `Database error querying schema` / `column users.banned_until does not exist`
echo "  restarting kiba-supabase-auth to force its internal migrations"
docker restart kiba-supabase-auth >/dev/null
for _ in $(seq 1 30); do
  state=$(docker inspect -f '{{.State.Health.Status}}' kiba-supabase-auth 2>/dev/null || echo "unknown")
  if [ "$state" = "healthy" ]; then echo "  kiba-supabase-auth healthy."; break; fi
  sleep 1
done

echo "== 4. Apply migrations =="
PGPW=$(grep -E '^POSTGRES_PASSWORD=' "$LOCAL/.env" | cut -d= -f2)

# All kibarometer migrations are idempotent from day one (no two-stage
# bootstrap like tenki has). Loop and tolerate per-migration failures so one
# bad file doesn't abort the bring-up.
shopt -s nullglob
migrations=("$ROOT"/supabase/migrations/00*.sql)
shopt -u nullglob
if [ ${#migrations[@]} -eq 0 ]; then
  echo "  (no migrations yet — supabase/migrations/ is empty; that's expected at Phase 1)"
else
  failed=()
  for m in "${migrations[@]}"; do
    fname=$(basename "$m")
    echo "    applying $fname"
    if ! docker exec -i -e PGPASSWORD="$PGPW" kiba-supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$m" >/dev/null 2>&1; then
      echo "      WARN: $fname failed — continuing"
      failed+=("$fname")
    fi
  done
  if [ ${#failed[@]} -gt 0 ]; then
    echo "  ${#failed[@]} migration(s) failed: ${failed[*]}"
    echo "  re-run a failing one for the full error:"
    echo "    docker exec -i -e PGPASSWORD=\"\$PGPW\" kiba-supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/migrations/<file>"
  fi
fi

echo "== 5. Create super_admin user =="
SVC=$(grep -E '^SERVICE_ROLE_KEY=' "$LOCAL/.env" | cut -d= -f2)
SUPABASE_URL=http://localhost:8000 SERVICE_ROLE_KEY="$SVC" \
  node "$LOCAL/create-admin-user.mjs" "$ADMIN_EMAIL" "$ADMIN_PASS" "$ADMIN_NAME" || true

echo
echo "==========================================================="
echo "  Local stack is up."
echo "  Admin (Phase 1 stub): http://localhost:4000/admin/health"
echo "  Supabase Studio:      http://localhost:8000  (Basic auth — DASHBOARD_USERNAME/PASSWORD in local-dev/.env)"
echo "  Postgres:             localhost:5432  (user=postgres, pw in local-dev/.env)"
echo "  Login (Phase 3):      $ADMIN_EMAIL  /  $ADMIN_PASS"
echo "==========================================================="
echo "  Stop:    ./local-dev/setup.sh down"
echo "  Wipe:    ./local-dev/setup.sh wipe"
echo "  Re-deploy admin code: docker restart kiba-admin"
echo "==========================================================="
