#!/usr/bin/env bash
# scripts/deploy.sh — runs on the VPS as the deploy user. Called by GitHub
# Actions via SSH after scp-action uploaded fresh source to /opt/kibarometer/incoming/.
# Assumes scripts/bootstrap.sh has already brought up the supabase fleet at
# least once (Phase 7).
set -euo pipefail

INCOMING=/opt/kibarometer/incoming
WEBSITE=/opt/kibarometer/website
ADMIN=/opt/kibarometer/admin
TAG="kiba-web:gh-$(date +%Y%m%d-%H%M%S)"

echo "== validate =="
[[ -d "$INCOMING" && -f "$INCOMING/docker/web.Dockerfile" ]] || { echo "no source"; exit 1; }
docker ps --format '{{.Names}}' | grep -q '^kiba-supabase-db$' || {
  echo "kiba-supabase-db not running — run bootstrap.sh --bring-up first"; exit 1;
}

# Phase 9 backfill: kiba-backup's env_file: requires backup.env to exist
# (compose v2 errors out otherwise). generate-secrets.sh creates it on
# fresh installs; this branch handles the existing VPS where bootstrap
# predates Phase 9. The container will keep restarting until the user
# fills in real B2 creds — that's intentional and benign.
if [[ ! -f /opt/kibarometer/env/backup.env ]]; then
  echo "== first-deploy backfill: create empty backup.env stub =="
  sudo tee /opt/kibarometer/env/backup.env >/dev/null <<'EOF'
# Fill these in after creating bucket + key in the Backblaze B2 console.
B2_APPLICATION_KEY_ID=
B2_APPLICATION_KEY=
B2_BUCKET=kibarometer-backups
# UPTIME_KUMA_HEARTBEAT_URL=
EOF
  sudo chown deploy:deploy /opt/kibarometer/env/backup.env
  sudo chmod 600 /opt/kibarometer/env/backup.env
fi

cd "$INCOMING"

echo "== stage .env.production for the Next.js build =="
sudo cp /opt/kibarometer/env/.env.production "$INCOMING/.env.production"
sudo chown deploy:deploy "$INCOMING/.env.production"

echo "== build $TAG =="
docker build \
  --build-arg NEXT_PUBLIC_SITE_URL=https://kibarometer.no \
  -f docker/web.Dockerfile -t "$TAG" .
rm -f "$INCOMING/.env.production"

echo "== sync admin sources =="
# Single bind-mount /opt/kibarometer/admin:/app:ro means everything the admin
# imports has to land directly under $ADMIN/. Layout (matches imports in
# scripts/admin-server.js):
#   $ADMIN/server.js
#   $ADMIN/sections/{shared,jobs}.js
#   $ADMIN/nav/client.js
#   $ADMIN/fetcher-entrypoint.sh, fetcher-crontab  (consumed by kiba-fetcher)
#   $ADMIN/backup.sh                                (consumed by kiba-backup)
sudo install -d -o deploy -g deploy "$ADMIN" "$ADMIN/sections" "$ADMIN/nav"
sudo cp "$INCOMING/scripts/admin-server.js"          "$ADMIN/server.js"
sudo cp -r "$INCOMING/scripts/admin-sections/."      "$ADMIN/sections/"
sudo cp -r "$INCOMING/scripts/nav/."                 "$ADMIN/nav/"
sudo cp "$INCOMING/scripts/fetcher-entrypoint.sh"    "$ADMIN/fetcher-entrypoint.sh"
sudo cp "$INCOMING/scripts/fetcher-crontab"          "$ADMIN/fetcher-crontab"
sudo cp "$INCOMING/scripts/backup.sh"                "$ADMIN/backup.sh"
sudo chmod +x "$ADMIN/backup.sh"
sudo chown -R deploy:deploy "$ADMIN"

echo "== update website compose files =="
# Pin the freshly-built image into compose.boot.yml's `image:` line (which is
# the override that takes effect for compose up).
sudo sed -i "s|^\(\s*image:\s*\)kiba-web:[^[:space:]]*|\1$TAG|" "$INCOMING/compose.boot.yml"
sudo cp "$INCOMING/compose.yml"                            "$WEBSITE/compose.yml"
sudo cp "$INCOMING/compose.boot.yml"                       "$WEBSITE/compose.boot.yml"
sudo cp "$INCOMING/compose.prod.yml"                       "$WEBSITE/compose.prod.yml"
sudo cp "$INCOMING/docker/supabase/docker-compose.yml"     "$WEBSITE/docker/supabase/docker-compose.yml"

echo "== apply idempotent migrations =="
# Add new filenames here as you write them. They MUST be idempotent.
PGPW=$(grep '^POSTGRES_PASSWORD=' /opt/kibarometer/env/supabase.env | cut -d= -f2)
for migration in 0001_baseline.sql 0002_nav_raw.sql 0005_jobs.sql 0006_keywords.sql 0006a_jobs_metadata.sql 0007_nav_postings.sql 0008_nav_snapshots.sql; do
  if [[ -f "$INCOMING/supabase/migrations/$migration" ]]; then
    echo "  applying $migration"
    if ! docker exec -i -e PGPASSWORD="$PGPW" kiba-supabase-db \
         psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$INCOMING/supabase/migrations/$migration"; then
      echo "  WARN: $migration failed — continuing so a partial deploy still rolls"
    fi
  fi
done

# Backfill public.profiles for any auth.users that predate 0001_baseline.
docker exec -e PGPASSWORD="$PGPW" kiba-supabase-db psql -U postgres -d postgres -tAc "
do \$\$ begin
  if to_regclass('public.profiles') is not null then
    insert into public.profiles (id, full_name, role)
    select id,
           coalesce(raw_user_meta_data->>'full_name', email),
           coalesce(raw_user_meta_data->>'role', 'employee')
    from auth.users
    on conflict (id) do nothing;
  end if;
end \$\$;" >/dev/null

echo "== compose up (kiba-web + kiba-admin + kiba-fetcher + kiba-backup + kiba-redis — supabase fleet stays running) =="
cd "$WEBSITE"
# kiba-redis must be in the explicit list. compose's depends_on cascade is
# unreliable here — Phase 10 verification caught that the very first deploy
# never created the redis container despite kiba-web depending on it.
docker compose --env-file /opt/kibarometer/env/supabase.env \
  -f compose.yml -f docker/supabase/docker-compose.yml \
  -f compose.prod.yml -f compose.boot.yml \
  up -d --force-recreate --remove-orphans kiba-web kiba-admin kiba-fetcher kiba-backup kiba-redis

# Recreate kong too — the alias override lives in compose.boot.yml. Without
# this, an old kong container with the default `kong` alias keeps running
# and tenki's `kong` lookups still bleed to us.
docker compose --env-file /opt/kibarometer/env/supabase.env \
  -f compose.yml -f docker/supabase/docker-compose.yml \
  -f compose.prod.yml -f compose.boot.yml \
  up -d --force-recreate --no-deps kong

# Strip the default `kong` network alias. Compose's `aliases:` override is
# ADDITIVE — even with `aliases: [kiba-supabase-kong]` in compose.boot.yml,
# the container still gets `kong` as an alias from its service name, and
# edge-caddy-1 (multi-network) resolves bare `kong` to whichever network
# answers first, breaking tenki's /supabase/* routing. Disconnect/reconnect
# with explicit --alias is the only way to drop the default. Verified
# empirically post-PR#11: without this step the alias was
# `kong api-gw kiba-supabase-kong`; with it, just `kiba-supabase-kong`.
docker network disconnect kiba kiba-supabase-kong 2>/dev/null || true
docker network connect --alias kiba-supabase-kong kiba kiba-supabase-kong

echo "== healthcheck =="
for i in $(seq 1 24); do
  if docker exec kiba-web wget -qO- http://127.0.0.1:3000/healthz >/dev/null 2>&1; then
    echo "web up after ${i}x5s"; break
  fi
  sleep 5
done

echo "== sync edge fragment =="
# Write our own routing fragment to the SHARED edge. Never modify Caddyfile,
# /opt/edge/compose.yml, or /opt/edge/data/ — those belong to the edge owner.
sudo cp "$INCOMING/docker/edge/sites/kibarometer.caddy" /opt/edge/sites/kibarometer.caddy
docker network connect kiba edge-caddy-1 2>/dev/null || true
for i in $(seq 1 10); do
  if docker exec edge-caddy-1 wget -qO- http://127.0.0.1:2019/config/ >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec edge-caddy-1 caddy reload --config /etc/caddy/Caddyfile

echo "== external smoke =="
smoke() {
  local url=$1
  for i in $(seq 1 6); do
    if curl -fsS "$url" -o /dev/null; then echo "  $url OK (after $((i*5))s)"; return 0; fi
    sleep 5
  done
  echo "  FAIL: $url"; return 1
}
smoke https://kibarometer.no/healthz
smoke https://kibarometer.no/admin/login

echo "== cleanup old images (keep 3 most-recent kiba-web tags) =="
docker images "kiba-web" --format "{{.Tag}}" | grep '^gh-' | sort -r | tail -n +4 | while read -r t; do
  docker rmi "kiba-web:$t" 2>/dev/null || true
done

echo "== archive incoming =="
ARCHIVE="/opt/kibarometer/build/$(date +%Y%m%d-%H%M%S)"
sudo install -d -o deploy -g deploy "$ARCHIVE"
sudo mv "$INCOMING"/* "$ARCHIVE/" 2>/dev/null || true
ls -dt /opt/kibarometer/build/*/ 2>/dev/null | tail -n +6 | xargs -r sudo rm -rf

echo "== deploy green =="
echo "tag=$TAG"
