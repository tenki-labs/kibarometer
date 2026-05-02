#!/bin/sh
# scripts/backup.sh — runs inside the kiba-backup sidecar at 03:00 daily.
# Pipes pg_dump (via docker exec on the host socket) to a temp file, ships it
# to Backblaze B2 with rclone. On Sundays, also writes a weekly snapshot.
#
# Manual trigger for verify:  docker exec kiba-backup /backup.sh
#
# Required env (from /opt/kibarometer/env/backup.env):
#   B2_APPLICATION_KEY_ID  B2_APPLICATION_KEY  B2_BUCKET
# Optional:
#   PG_CONTAINER (default kiba-supabase-db)
#   PG_USER (default postgres)
#   PG_DB (default postgres)
#   UPTIME_KUMA_HEARTBEAT_URL (skip ping if unset)
set -eu

: "${B2_APPLICATION_KEY_ID:?Set B2_APPLICATION_KEY_ID in /opt/kibarometer/env/backup.env}"
: "${B2_APPLICATION_KEY:?Set B2_APPLICATION_KEY in /opt/kibarometer/env/backup.env}"
: "${B2_BUCKET:?Set B2_BUCKET in /opt/kibarometer/env/backup.env (e.g. kibarometer-backups)}"
: "${PG_CONTAINER:=kiba-supabase-db}"
: "${PG_USER:=postgres}"
: "${PG_DB:=postgres}"

DATE=$(date +%F)
WEEK=$(date +%Y-W%V)
DOW=$(date +%u)
TMP=$(mktemp -d)
RCLONE_CONF="$TMP/rclone.conf"
trap 'rm -rf "$TMP"' EXIT

cat > "$RCLONE_CONF" <<EOF
[b2]
type = b2
account = ${B2_APPLICATION_KEY_ID}
key = ${B2_APPLICATION_KEY}
endpoint =
EOF

echo "== 1. Postgres dump =="
PG_DUMP="$TMP/kiba-pg-${DATE}.dump"
docker exec -i "$PG_CONTAINER" pg_dump -Fc -U "$PG_USER" "$PG_DB" > "$PG_DUMP"
rclone --config "$RCLONE_CONF" copy "$PG_DUMP" "b2:${B2_BUCKET}/nightly/"

if [ "$DOW" = "7" ]; then
  echo "== 2. Weekly snapshot (Sunday) =="
  WEEK_DUMP="$TMP/kiba-pg-${WEEK}.dump"
  cp "$PG_DUMP" "$WEEK_DUMP"
  rclone --config "$RCLONE_CONF" copy "$WEEK_DUMP" "b2:${B2_BUCKET}/weekly/"
fi

echo "== 3. Heartbeat =="
if [ -n "${UPTIME_KUMA_HEARTBEAT_URL:-}" ]; then
  curl -fsS "$UPTIME_KUMA_HEARTBEAT_URL" >/dev/null
fi

echo "Backup ${DATE} OK"
