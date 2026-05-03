#!/usr/bin/env bash
# scripts/generate-secrets.sh — mint all VPS env files in one shot.
# Writes /opt/kibarometer/env/{supabase,admin,fetcher}.env and .env.production
# (mode 600 owner deploy:deploy). Refuses to overwrite anything that exists.
#
# Run via sudo on the VPS, after bootstrap.sh has created the env dir:
#   sudo bash /opt/kibarometer/incoming/scripts/generate-secrets.sh
set -euo pipefail

if [[ $EUID -ne 0 ]]; then echo "run as root (sudo)"; exit 1; fi

ENV_DIR=/opt/kibarometer/env
[[ -d "$ENV_DIR" ]] || { echo "$ENV_DIR not found — run bootstrap.sh first"; exit 1; }

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

# Refuse to clobber any existing env file.
for f in supabase.env admin.env fetcher.env backup.env umami.env .env.production; do
  if [[ -f "$ENV_DIR/$f" ]]; then
    echo "$ENV_DIR/$f already exists — refusing to overwrite. Move it aside first if you really want to regenerate."
    exit 1
  fi
done

echo "== mint secrets =="
POSTGRES_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 64)
DASHBOARD_PASSWORD=$(openssl rand -hex 12)
SECRET_KEY_BASE=$(openssl rand -hex 32)
VAULT_ENC_KEY=$(openssl rand -hex 16)
PG_META_CRYPTO_KEY=$(openssl rand -hex 16)
FETCHER_TOKEN=$(openssl rand -hex 32)
UMAMI_HASH_SALT=$(openssl rand -hex 32)
UMAMI_APP_SECRET=$(openssl rand -hex 32)

ANON_KEY=$(JWT_SECRET="$JWT_SECRET" node "$SCRIPT_DIR/mint-jwt.mjs" anon)
SERVICE_ROLE_KEY=$(JWT_SECRET="$JWT_SECRET" node "$SCRIPT_DIR/mint-jwt.mjs" service_role)

echo "== write supabase.env =="
# Seeded from upstream supabase example (committed at docker/supabase/.env.example);
# we patch the secrets we generated. The upstream compose references many
# vars even for services we removed (storage/imgproxy/etc.) — leaving them
# at example values is harmless because those services don't run.
install -m 600 -o deploy -g deploy "$SCRIPT_DIR/../docker/supabase/.env.example" "$ENV_DIR/supabase.env"
ed -s "$ENV_DIR/supabase.env" <<EOF
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
,s|^SUPABASE_PUBLIC_URL=.*|SUPABASE_PUBLIC_URL=https://kibarometer.no/supabase|
,s|^API_EXTERNAL_URL=.*|API_EXTERNAL_URL=https://kibarometer.no/supabase|
w
q
EOF

echo "== write admin.env =="
# UMAMI_USERNAME / UMAMI_PASSWORD / UMAMI_WEBSITE_ID / NEXT_PUBLIC_UMAMI_WEBSITE_ID
# are blank until the operator does the one-time Umami setup (see
# /admin/analytics instructions). Until they're filled in, the analytics page
# renders a "not configured" card and the public site omits the tracker script.
install -m 600 -o deploy -g deploy /dev/stdin "$ENV_DIR/admin.env" <<EOF
PORT=4000
NODE_ENV=production
SUPABASE_INTERNAL_URL=http://kiba-supabase-kong:8000
SUPABASE_ANON_KEY=$ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
SUPABASE_JWT_SECRET=$JWT_SECRET
SUPABASE_EXTERNAL_URL=https://kibarometer.no/supabase
PUBLIC_BASE_URL=https://kibarometer.no
REDIS_URL=redis://kiba-redis:6379
FETCHER_TOKEN=$FETCHER_TOKEN
UMAMI_INTERNAL_URL=http://kiba-umami:3000
UMAMI_USERNAME=
UMAMI_PASSWORD=
UMAMI_WEBSITE_ID=
NEXT_PUBLIC_UMAMI_WEBSITE_ID=
# LLM analytics — token must be provisioned manually at tenki.no's
# /admin/api-tokens/new and pasted into MLX_API_KEY below. Until it is,
# Tier 1/Tier 2 cron handlers return {skipped: 'no_api_key'} and the
# /admin/llm page shows "not configured".
MLX_BASE_URL=https://mlx.tenki.no/v1
MLX_API_KEY=
EOF

echo "== write fetcher.env =="
install -m 600 -o deploy -g deploy /dev/stdin "$ENV_DIR/fetcher.env" <<EOF
FETCHER_TOKEN=$FETCHER_TOKEN
ADMIN_URL=http://kiba-web:3000
EOF

echo "== write umami.env =="
# Umami v2 reads its config from these env vars. DATABASE_URL points at the
# `umami` database inside kiba-supabase-db (provisioned by 0009_umami_db.sql).
# Umami runs its own Prisma migrations on first boot.
install -m 600 -o deploy -g deploy /dev/stdin "$ENV_DIR/umami.env" <<EOF
DATABASE_TYPE=postgresql
DATABASE_URL=postgresql://postgres:$POSTGRES_PASSWORD@kiba-supabase-db:5432/umami
HASH_SALT=$UMAMI_HASH_SALT
APP_SECRET=$UMAMI_APP_SECRET
EOF

echo "== write backup.env stub =="
# B2 creds are NOT generated — they have to come from the Backblaze console.
# The kiba-backup container will keep restarting until these are filled in,
# then the next 03:00 cron tick takes over. UPTIME_KUMA_HEARTBEAT_URL is
# optional; leave commented out to skip the heartbeat ping.
install -m 600 -o deploy -g deploy /dev/stdin "$ENV_DIR/backup.env" <<EOF
# Fill these in after creating the bucket + application key at
# https://secure.backblaze.com/user_signin.htm
# Suggested bucket name: kibarometer-backups (private)
B2_APPLICATION_KEY_ID=
B2_APPLICATION_KEY=
B2_BUCKET=kibarometer-backups
# UPTIME_KUMA_HEARTBEAT_URL=
EOF

echo "== write .env.production =="
# Marketing Next.js env. The home page is static today (Phase 5); these
# are needed by lib/env.ts as soon as Phase 8 wires PostgREST reads.
# NEXT_PUBLIC_UMAMI_WEBSITE_ID is omitted here on purpose — deploy.sh's merge
# step pulls it across from admin.env each deploy so it can be filled in
# without re-running this script.
install -m 600 -o deploy -g deploy /dev/stdin "$ENV_DIR/.env.production" <<EOF
NEXT_PUBLIC_SITE_URL=https://kibarometer.no
NEXT_PUBLIC_SUPABASE_URL=https://kibarometer.no/supabase
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
SUPABASE_INTERNAL_URL=http://kiba-supabase-kong:8000
EOF

echo
echo "== done =="
echo "Wrote (mode 600, owner deploy:deploy):"
ls -la "$ENV_DIR"
echo
echo "Next: scp the compose files into /opt/kibarometer/website/, then"
echo "      sudo bash $SCRIPT_DIR/bootstrap.sh --bring-up"
