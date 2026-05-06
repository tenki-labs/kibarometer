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

# Phase G backfill: kiba-umami's env_file: requires umami.env to exist.
# Same pattern as the backup.env block above. POSTGRES_PASSWORD is read from
# the existing supabase.env so Umami can connect to the `umami` database
# inside kiba-supabase-db (provisioned by 0009_umami_db.sql).
if [[ ! -f /opt/kibarometer/env/umami.env ]]; then
  echo "== first-deploy backfill: mint umami.env =="
  PGPW=$(sudo grep '^POSTGRES_PASSWORD=' /opt/kibarometer/env/supabase.env | cut -d= -f2)
  HASH_SALT=$(openssl rand -hex 32)
  APP_SECRET=$(openssl rand -hex 32)
  sudo tee /opt/kibarometer/env/umami.env >/dev/null <<EOF
DATABASE_TYPE=postgresql
DATABASE_URL=postgresql://postgres:${PGPW}@kiba-supabase-db:5432/umami
HASH_SALT=${HASH_SALT}
APP_SECRET=${APP_SECRET}
EOF
  sudo chown deploy:deploy /opt/kibarometer/env/umami.env
  sudo chmod 600 /opt/kibarometer/env/umami.env
fi

# Phase G backfill: idempotently append UMAMI_* placeholders to admin.env on
# existing VPSes so the merge loop below has something to find. Operator
# fills the real values in after first-time Umami setup (see analytics page).
ADMIN_ENV_PRE=/opt/kibarometer/env/admin.env
for KV in "UMAMI_INTERNAL_URL=http://kiba-umami:3000" "UMAMI_USERNAME=" "UMAMI_PASSWORD=" "UMAMI_WEBSITE_ID=" "NEXT_PUBLIC_UMAMI_WEBSITE_ID="; do
  KEY=${KV%%=*}
  if ! sudo grep -q "^${KEY}=" "$ADMIN_ENV_PRE"; then
    echo "  appending $KEY to admin.env"
    echo "$KV" | sudo tee -a "$ADMIN_ENV_PRE" >/dev/null
  fi
done

# LLM analytics backfill: idempotently append MLX_* placeholders to admin.env
# on existing VPSes so the merge loop below picks them up. MLX_API_KEY is
# blank by default — operator pastes the tnk_… token from tenki.no's
# /admin/api-tokens/new. Until then, /admin/llm renders "not configured".
for KV in "MLX_BASE_URL=https://mlx.tenki.no/v1" "MLX_API_KEY="; do
  KEY=${KV%%=*}
  if ! sudo grep -q "^${KEY}=" "$ADMIN_ENV_PRE"; then
    echo "  appending $KEY to admin.env"
    echo "$KV" | sudo tee -a "$ADMIN_ENV_PRE" >/dev/null
  fi
done

cd "$INCOMING"

echo "== merge admin secrets into .env.production =="
# kiba-web reads .env.production at startup. admin.env is the source of
# truth — we propagate two values that kiba-web's admin needs:
#   SUPABASE_JWT_SECRET — verifies the sb_access_token cookie (HS256)
#   FETCHER_TOKEN       — bearer for /admin/api/jobs/*
# Upserted on every deploy. The earlier append-once design silently blocked
# token rotation: rotating in admin.env left the stale value in
# .env.production, and every cron tick 401'd until someone hand-edited it.
# Same upsert pattern as UMAMI/MLX below.
PROD_ENV=/opt/kibarometer/env/.env.production
ADMIN_ENV=/opt/kibarometer/env/admin.env
for KEY in SUPABASE_JWT_SECRET FETCHER_TOKEN; do
  VAL=$(sudo grep "^${KEY}=" "$ADMIN_ENV" | cut -d= -f2-)
  if [[ -z "$VAL" ]]; then
    echo "  WARN: $KEY missing from $ADMIN_ENV — kiba-web admin will fail to start"
    continue
  fi
  if sudo grep -q "^${KEY}=" "$PROD_ENV"; then
    sudo sed -i "s|^${KEY}=.*|${KEY}=${VAL}|" "$PROD_ENV"
  else
    echo "${KEY}=${VAL}" | sudo tee -a "$PROD_ENV" >/dev/null
  fi
done

# Mutable Umami config — upsert every deploy. UMAMI_USERNAME/PASSWORD/WEBSITE_ID
# start blank and only get filled in after the operator does first-time Umami
# setup (port-forwarded UI). Once they are filled in, every subsequent deploy
# needs to pick up the new values, hence sed-replace + append fallback.
for KEY in UMAMI_INTERNAL_URL UMAMI_USERNAME UMAMI_PASSWORD UMAMI_WEBSITE_ID NEXT_PUBLIC_UMAMI_WEBSITE_ID; do
  VAL=$(sudo grep "^${KEY}=" "$ADMIN_ENV" 2>/dev/null | cut -d= -f2- || echo "")
  if sudo grep -q "^${KEY}=" "$PROD_ENV"; then
    sudo sed -i "s|^${KEY}=.*|${KEY}=${VAL}|" "$PROD_ENV"
  else
    echo "${KEY}=${VAL}" | sudo tee -a "$PROD_ENV" >/dev/null
  fi
done

# Mutable MLX config — same upsert pattern as UMAMI. MLX_API_KEY starts blank
# until the operator provisions a tnk_… token at tenki.no's
# /admin/api-tokens/new. Once filled in, subsequent deploys propagate it.
for KEY in MLX_BASE_URL MLX_API_KEY; do
  VAL=$(sudo grep "^${KEY}=" "$ADMIN_ENV" 2>/dev/null | cut -d= -f2- || echo "")
  if sudo grep -q "^${KEY}=" "$PROD_ENV"; then
    sudo sed -i "s|^${KEY}=.*|${KEY}=${VAL}|" "$PROD_ENV"
  else
    echo "${KEY}=${VAL}" | sudo tee -a "$PROD_ENV" >/dev/null
  fi
done

echo "== stage .env.production for the Next.js build =="
sudo cp /opt/kibarometer/env/.env.production "$INCOMING/.env.production"
sudo chown deploy:deploy "$INCOMING/.env.production"

echo "== build $TAG =="
docker build \
  --build-arg NEXT_PUBLIC_SITE_URL=https://kibarometer.no \
  -f docker/web.Dockerfile -t "$TAG" .
rm -f "$INCOMING/.env.production"

echo "== sync sidecar sources =="
# kiba-fetcher and kiba-backup still bind-mount specific files from
# /opt/kibarometer/admin/ (see compose.yml). The legacy admin-server.js +
# admin-sections/ + scripts/nav/ that used to live here were retired with
# kiba-admin — admin behaviour now lives entirely inside kiba-web.
sudo install -d -o deploy -g deploy "$ADMIN"
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
for migration in 0001_baseline.sql 0002_nav_raw.sql 0005_jobs.sql 0006_keywords.sql 0006a_jobs_metadata.sql 0007_nav_postings.sql 0008_nav_snapshots.sql 0009_umami_db.sql 0010_admin_diag.sql 0011_site_content.sql 0012_jobs_progress.sql 0013_admin_list_columns.sql 0014_nav_postings_llm_columns.sql 0015_keyword_status.sql 0016_keyword_candidates.sql 0017_taxonomy.sql 0018_llm_prompts.sql 0019_promote_keyword_candidate.sql 0020_mlx_health.sql 0021_skill_snapshot.sql 0022_retire_redundant_keywords.sql 0023_nav_postings_nav_raw_id_idx.sql 0024_app_settings.sql 0025_jobs_trigger_fast_forward.sql 0026_site_content_media.sql 0027_snapshot_categories_daily.sql 0028_fix_skill_snapshot_jsonb_path.sql 0029_media.sql 0030_brreg.sql 0031_media_llm_prompts.sql 0032_site_content_mediedekning.sql 0033_brreg_floor_deprecated.sql 0034_keyword_candidates_media.sql 0035_more_media_sources.sql 0036_media_retagged_at.sql 0037_brreg_llm_columns.sql 0038_brreg_categories.sql 0039_brreg_llm_prompts.sql 0040_keyword_candidates_brreg.sql 0041_keyword_candidates_jsonb_refactor.sql; do
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

echo "== compose up (kiba-web + kiba-fetcher + kiba-backup + kiba-redis — supabase fleet stays running) =="
cd "$WEBSITE"
# kiba-redis must be in the explicit list. compose's depends_on cascade is
# unreliable here — Phase 10 verification caught that the very first deploy
# never created the redis container despite kiba-web depending on it.
#
# Phase F PR 4: kiba-admin dropped from the recreate list (admin lives in
# kiba-web now). The container itself is left running on the VPS for one
# cycle so an operator can `docker rm -f kiba-admin` once the cutover smoke
# passes; PR 5 will remove the kiba-admin block from compose.boot.yml.
docker compose --env-file /opt/kibarometer/env/supabase.env \
  -f compose.yml -f docker/supabase/docker-compose.yml \
  -f compose.prod.yml -f compose.boot.yml \
  up -d --force-recreate --remove-orphans kiba-web kiba-fetcher kiba-backup kiba-redis kiba-umami

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

# Sanity check the bearer-authed cron route landed on kiba-web. No bearer →
# 401 from lib/admin/bearer.ts; this catches the routing being wrong (would
# 404 if the route handler is missing) or the env var being absent (500).
echo "  testing /admin/api/jobs/refresh-snapshots returns 401 without bearer"
status=$(curl -sS -o /dev/null -w "%{http_code}" -X POST https://kibarometer.no/admin/api/jobs/refresh-snapshots || echo "000")
if [[ "$status" != "401" ]]; then
  echo "  FAIL: expected 401, got $status"; exit 1
fi
echo "  OK"

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
