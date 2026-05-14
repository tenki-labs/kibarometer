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

# Manual-only Claude backfill drain: idempotently append ANTHROPIC_* placeholders.
# ANTHROPIC_API_KEY blank by default — operator pastes a sk-ant-… key from the
# Anthropic console. Until then, the /admin/llm "Backfill via Claude" card
# renders the not-configured alert. ANTHROPIC_CONCURRENCY defaults to 4 inside
# the orchestrator; raise to 8 once on Anthropic Tier 2+.
for KV in "ANTHROPIC_API_KEY=" "ANTHROPIC_CONCURRENCY="; do
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

# Mutable Anthropic config — gates the manual "Backfill via Claude" buttons
# on /admin/llm. Blank by default; operator pastes a sk-ant-… key from the
# Anthropic console. ANTHROPIC_CONCURRENCY can override the default p-limit
# (4) for orgs on Anthropic Tier 2+ that can sustain higher RPM.
for KEY in ANTHROPIC_API_KEY ANTHROPIC_CONCURRENCY; do
  VAL=$(sudo grep "^${KEY}=" "$ADMIN_ENV" 2>/dev/null | cut -d= -f2- || echo "")
  if sudo grep -q "^${KEY}=" "$PROD_ENV"; then
    sudo sed -i "s|^${KEY}=.*|${KEY}=${VAL}|" "$PROD_ENV"
  else
    echo "${KEY}=${VAL}" | sudo tee -a "$PROD_ENV" >/dev/null
  fi
done

# Internal-only — kiba-web reaches the scraper sidecar at this URL on the
# kiba Docker network. Hardcoded; not a secret. Propagated into the env
# file kiba-scraper itself reads (via env_file: in compose.yml) so MLX_*
# travels with it.
if ! sudo grep -q "^SCRAPER_URL=" "$PROD_ENV"; then
  echo "SCRAPER_URL=http://kiba-scraper:8000" | sudo tee -a "$PROD_ENV" >/dev/null
fi

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

# kiba-scraper sidecar (PR #79) — compose.yml has `build: context: docker/scraper`
# so the build context must exist under $WEBSITE/docker/scraper at compose-up
# time. install -d is idempotent; cp -r mirrors the source tree.
sudo install -d -o deploy -g deploy "$WEBSITE/docker/scraper"
sudo cp -r "$INCOMING/docker/scraper/." "$WEBSITE/docker/scraper/"
sudo chown -R deploy:deploy "$WEBSITE/docker/scraper"

echo "== apply idempotent migrations =="
# Add new filenames here as you write them. They MUST be idempotent.
PGPW=$(grep '^POSTGRES_PASSWORD=' /opt/kibarometer/env/supabase.env | cut -d= -f2)
for migration in 0001_baseline.sql 0002_nav_raw.sql 0005_jobs.sql 0006_keywords.sql 0006a_jobs_metadata.sql 0007_nav_postings.sql 0008_nav_snapshots.sql 0009_umami_db.sql 0010_admin_diag.sql 0011_site_content.sql 0012_jobs_progress.sql 0013_admin_list_columns.sql 0014_nav_postings_llm_columns.sql 0015_keyword_status.sql 0016_keyword_candidates.sql 0017_taxonomy.sql 0018_llm_prompts.sql 0019_promote_keyword_candidate.sql 0020_mlx_health.sql 0021_skill_snapshot.sql 0022_retire_redundant_keywords.sql 0023_nav_postings_nav_raw_id_idx.sql 0024_app_settings.sql 0025_jobs_trigger_fast_forward.sql 0026_site_content_media.sql 0027_snapshot_categories_daily.sql 0028_fix_skill_snapshot_jsonb_path.sql 0029_media.sql 0030_brreg.sql 0031_media_llm_prompts.sql 0032_site_content_mediedekning.sql 0033_brreg_floor_deprecated.sql 0034_keyword_candidates_media.sql 0035_more_media_sources.sql 0036_media_retagged_at.sql 0037_brreg_llm_columns.sql 0038_brreg_categories.sql 0039_brreg_llm_prompts.sql 0040_keyword_candidates_brreg.sql 0041_keyword_candidates_jsonb_refactor.sql 0042_brreg_snapshot_timeout.sql 0043_site_content_docs.sql 0044_scrapegraph_backfill_method.sql 0045_metode_to_docs.sql 0046_retire_mediedekning_content.sql 0047_brreg_2018_floor.sql 0048_brreg_founder_age_yearly.sql 0049_fix_refresh_snapshot_keywords.sql 0050_ingest_mode.sql 0051_brreg_founder_age_monthly.sql 0052_brreg_snapshot_keywords.sql 0053_oppstart_methodology_keyword_only.sql 0054_docs_jobbmarked_media_keyword_first.sql 0055_tier1_prompt_drop_ai_relevant.sql 0056_tier2_coverage_daily.sql 0057_scrapegraph_only.sql 0058_brreg_founder_age_monthly_mean.sql 0059_jobs_trigger_post_reprocess.sql 0060_arbeidsmarked_prose.sql 0061_media_sitemap_method.sql 0062_media_queue_ingest_mode_priority.sql 0063_media_backfill_floor.sql 0064_brreg_financials.sql 0064_offentlig_storting.sql 0065_brreg_snapshot_quarterly_ai_growth.sql 0066_media_snapshot_floor.sql 0067_offentlig_storting_llm_prompts.sql 0068_offentlig_snapshots.sql 0069_site_content_landing_version.sql 0070_fix_brreg_financials_top1pct_filter.sql 0071_oppstart_methodology_financials.sql 0072_oppstart_methodology_survivor_bias.sql; do
  if [[ -f "$INCOMING/supabase/migrations/$migration" ]]; then
    # Wrap each migration in a single transaction so a mid-file failure
    # rolls back cleanly instead of leaving the schema half-applied.
    # 0009_umami_db.sql uses \gexec → CREATE DATABASE, which cannot run
    # inside a transaction (the migration's header comment documents
    # this), so we autocommit any migration containing \gexec.
    if grep -q '\\gexec' "$INCOMING/supabase/migrations/$migration"; then
      TX_FLAG=""
    else
      TX_FLAG="--single-transaction"
    fi
    echo "  applying $migration${TX_FLAG:+ (txn)}"
    if ! docker exec -i -e PGPASSWORD="$PGPW" kiba-supabase-db \
         psql -U postgres -d postgres -v ON_ERROR_STOP=1 $TX_FLAG < "$INCOMING/supabase/migrations/$migration"; then
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

echo "== stage edge + cloudflared config (must precede compose up so bind mounts resolve) =="
# kiba-edge-caddy and cloudflared bind-mount config files from
# /opt/kibarometer/{edge,cloudflared}/. On first deploy these don't exist
# yet, and Docker would silently create empty *directories* at the bind-
# mount source (then both containers would fail to start). Stage all files
# here, before `compose up`.
#
# bootstrap.sh creates the dirs; the `sudo install -d` calls are defensive
# in case deploy.sh runs against a host whose bootstrap.sh predates this
# change. `/usr/bin/install` is in the deploy user's sudoers whitelist.
#
# credentials.json is NEVER staged from the repo — it's a secret minted by
# `cloudflared tunnel create` and only ever lives on the host. The file
# stays put across deploys; we only refresh config.yml here.
sudo install -d -o deploy -g deploy /opt/kibarometer/edge/sites /opt/kibarometer/edge/data /opt/kibarometer/edge/config
sudo install -d -o deploy -g deploy /opt/kibarometer/cloudflared
install -m 644 "$INCOMING/docker/edge/Caddyfile"               /opt/kibarometer/edge/Caddyfile
install -m 644 "$INCOMING/docker/edge/sites/kibarometer.caddy" /opt/kibarometer/edge/sites/kibarometer.caddy
install -m 644 "$INCOMING/docker/cloudflared/config.yml"       /opt/kibarometer/cloudflared/config.yml

# Sanity check: refuse to bring up cloudflared if the credentials file is
# missing or the config still has the placeholder UUID. Either case means
# the operator hasn't completed the one-time `tunnel create` step.
if [[ ! -f /opt/kibarometer/cloudflared/credentials.json ]]; then
  echo "WARN: /opt/kibarometer/cloudflared/credentials.json missing —"
  echo "      run 'cloudflared tunnel login' + 'tunnel create' on the host"
  echo "      and copy the credentials JSON. cloudflared will keep restarting"
  echo "      until this is fixed."
fi
if grep -q REPLACE_WITH_TUNNEL_UUID /opt/kibarometer/cloudflared/config.yml; then
  echo "WARN: docker/cloudflared/config.yml still has REPLACE_WITH_TUNNEL_UUID —"
  echo "      replace it with the UUID printed by 'cloudflared tunnel create'."
fi

echo "== compose up (kiba-web + kiba-fetcher + kiba-backup + kiba-redis + kiba-edge-caddy + kiba-cloudflared — supabase fleet stays running) =="
cd "$WEBSITE"
# kiba-redis must be in the explicit list. compose's depends_on cascade is
# unreliable here — Phase 10 verification caught that the very first deploy
# never created the redis container despite kiba-web depending on it.
#
# --build rebuilds services with an active `build:` directive (kiba-scraper
# is the only one in this list — kiba-web is image-tagged above, the rest
# are pure `image:`). Without --build, edits under docker/scraper/ never
# reach the running container; layer caching in docker/scraper/Dockerfile
# keeps the rebuild cheap when only server.py / schemas.py changed.
#
# We do NOT force-recreate kong on every deploy. The Apollo migration
# removed the `kong` network-alias workaround (no tenki on this network →
# no alias collision). compose up reuses the running kong unless its config
# changed; on the rare config change, a manual `docker compose ... up -d
# --force-recreate --no-deps kong` does the job.
docker compose --env-file /opt/kibarometer/env/supabase.env \
  -f compose.yml -f docker/supabase/docker-compose.yml \
  -f compose.prod.yml -f compose.boot.yml \
  up -d --build --force-recreate --remove-orphans kiba-web kiba-fetcher kiba-backup kiba-redis kiba-umami kiba-scraper kiba-edge-caddy kiba-cloudflared

echo "== healthcheck =="
for i in $(seq 1 24); do
  if docker exec kiba-web wget -qO- http://127.0.0.1:3000/healthz >/dev/null 2>&1; then
    echo "web up after ${i}x5s"; break
  fi
  sleep 5
done

echo "== reload edge caddy (graceful, no connection drop) =="
# Edge config files were already staged before `compose up`; if this is a
# pure config redeploy (no service recreate), force-recreating the container
# in step "compose up" above wouldn't have happened, and the running Caddy
# is using the old config. A graceful reload picks up the new fragment
# without dropping connections.
#
# The `|| echo` swallows the harmless error when the container was just
# force-recreated by the compose up step (admin socket may still be coming
# up) — in that case the new container is already serving the staged config.
docker exec kiba-edge-caddy caddy reload --config /etc/caddy/Caddyfile 2>/dev/null || \
  echo "  reload skipped (container mid-start or just recreated)"

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

# Umami analytics smoke tests. Three independent failure modes to guard:
#
#   (a) /_umami/script.js — public tracker delivery. If kiba-edge-caddy's
#       /_umami/* handle_path breaks or kiba-umami stops serving, the public
#       site silently collects zero visits. Hard-fail the deploy.
#   (b) kiba-web → kiba-umami:3000 — internal hop the /admin/analytics page
#       uses. Catches docker DNS issues or kiba-umami in a "started but
#       broken" state. Hard-fail.
#   (c) Umami admin credentials — soft-warn only. /admin/analytics gracefully
#       degrades to the "not configured" card via umamiConfigured(), so bad
#       creds don't break user experience or cron pipelines. Skip entirely
#       when creds are empty (first-time setup pattern).
echo "  verifying /_umami/script.js delivers valid tracker"
tracker_body=$(curl -fsS https://kibarometer.no/_umami/script.js || echo "")
tracker_size=${#tracker_body}
if [[ "$tracker_size" -lt 1000 ]]; then
  echo "  FAIL: /_umami/script.js too small ($tracker_size bytes) — edge or kiba-umami broken"
  exit 1
fi
if ! echo "$tracker_body" | head -c 500 | grep -qE 'function|var |let |const |window'; then
  echo "  FAIL: /_umami/script.js body doesn't look like JavaScript"
  exit 1
fi
echo "  OK ($tracker_size bytes)"

echo "  verifying kiba-web → kiba-umami:3000/api/heartbeat"
if ! docker exec kiba-web wget -qO- http://kiba-umami:3000/api/heartbeat >/dev/null 2>&1; then
  echo "  FAIL: kiba-web cannot reach kiba-umami:3000 — /admin/analytics will throw"
  exit 1
fi
echo "  OK"

# Soft-warn credential check. We only test login if both username+password are
# set. The login flow matches lib/admin/umami.ts: POST {username,password}
# to /api/auth/login, expect 200 + a {"token":"…"} body.
UMAMI_USER=$(sudo grep '^UMAMI_USERNAME=' /opt/kibarometer/env/admin.env 2>/dev/null | cut -d= -f2- || echo "")
UMAMI_PASS=$(sudo grep '^UMAMI_PASSWORD=' /opt/kibarometer/env/admin.env 2>/dev/null | cut -d= -f2- || echo "")
if [[ -z "$UMAMI_USER" || -z "$UMAMI_PASS" ]]; then
  echo "  info: Umami credentials unset in admin.env — skipping login check"
else
  echo "  verifying Umami admin credentials authenticate"
  # busybox wget in the next-standalone image: --post-data + --header for JSON
  login_body=$(docker exec kiba-web sh -c "wget -qO- \
      --header='Content-Type: application/json' \
      --post-data='{\"username\":\"$UMAMI_USER\",\"password\":\"$UMAMI_PASS\"}' \
      http://kiba-umami:3000/api/auth/login" 2>/dev/null || echo "")
  if echo "$login_body" | grep -q '"token"'; then
    echo "  OK"
  else
    echo "  WARN: Umami login failed — /admin/analytics will render 'not configured' card."
    echo "        Check UMAMI_USERNAME / UMAMI_PASSWORD in /opt/kibarometer/env/admin.env."
  fi
fi

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
