#!/bin/sh
# scripts/backup.sh — runs inside the kiba-backup sidecar at 03:00 daily.
# Pipes pg_dump (via docker exec on the host socket) to a temp file, ships it
# to Backblaze B2 with rclone, then enforces retention so the bucket can never
# grow past the B2 storage cap.
#
# Manual trigger for verify:  docker exec kiba-backup /backup.sh
#
# Required env (from /opt/kibarometer/env/backup.env):
#   B2_APPLICATION_KEY_ID  B2_APPLICATION_KEY  B2_BUCKET
# Optional:
#   PG_CONTAINER (default kiba-supabase-db)
#   PG_USER (default postgres)
#   PG_DB (default postgres)
#   NIGHTLY_KEEP (default 14)   WEEKLY_KEEP (default 6)
#   UPTIME_KUMA_HEARTBEAT_URL (skip ping if unset)
#
# Retention (why it is the way it is):
#   * B2 buckets keep HIDDEN VERSIONS of deleted files, and those versions
#     still count toward the storage cap. `rclone delete` only hides — so we
#     set `hard_delete = true` and also run `rclone cleanup` so pruned dumps
#     actually free space. (A cap hit on 2026-09-09 that survived a plain
#     delete is exactly this trap.)
#   * Pruning runs BEFORE the upload, keeping KEEP-1 so the new dump brings
#     the count back to KEEP. This means a bucket sitting at the cap trims
#     itself and self-heals instead of wedging on 403 storage_cap_exceeded.
#   * Dumps are date-named, so a lexical sort is chronological and
#     "delete all but the newest N" is a head of the sorted list.
set -eu

: "${B2_APPLICATION_KEY_ID:?Set B2_APPLICATION_KEY_ID in /opt/kibarometer/env/backup.env}"
: "${B2_APPLICATION_KEY:?Set B2_APPLICATION_KEY in /opt/kibarometer/env/backup.env}"
: "${B2_BUCKET:?Set B2_BUCKET in /opt/kibarometer/env/backup.env (e.g. kibarometer-backups)}"
: "${PG_CONTAINER:=kiba-supabase-db}"
: "${PG_USER:=postgres}"
: "${PG_DB:=postgres}"
: "${NIGHTLY_KEEP:=14}"
: "${WEEKLY_KEEP:=6}"

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
hard_delete = true
endpoint =
EOF

# Keep only the newest $2 date-named dumps under the $1 subdir (nightly|weekly).
# Best-effort: a retention hiccup must never abort the backup itself.
prune_keep_last() {
  subdir="$1"
  keep="$2"
  [ "$keep" -lt 0 ] && keep=0
  listing=$(rclone --config "$RCLONE_CONF" lsf "b2:${B2_BUCKET}/${subdir}/" \
    --include 'kiba-pg-*.dump' 2>/dev/null | sort) || return 0
  total=$(printf '%s\n' "$listing" | grep -c . || true)
  [ "$total" -le "$keep" ] && return 0
  printf '%s\n' "$listing" | head -n "$((total - keep))" | while IFS= read -r f; do
    [ -n "$f" ] || continue
    rclone --config "$RCLONE_CONF" deletefile "b2:${B2_BUCKET}/${subdir}/${f}" || true
  done
}

echo "== 1. Postgres dump =="
PG_DUMP="$TMP/kiba-pg-${DATE}.dump"
docker exec -i "$PG_CONTAINER" pg_dump -Fc -U "$PG_USER" "$PG_DB" > "$PG_DUMP"

echo "== 2. Retention (prune before upload so a full bucket self-heals) =="
# Prune to KEEP-1; the upload below brings each series back to KEEP.
prune_keep_last nightly "$((NIGHTLY_KEEP - 1))" || true
if [ "$DOW" = "7" ]; then
  prune_keep_last weekly "$((WEEKLY_KEEP - 1))" || true
fi
# Purge hidden/old versions so the deletes above actually free bucket bytes.
rclone --config "$RCLONE_CONF" cleanup "b2:${B2_BUCKET}" || true

echo "== 3. Upload nightly =="
rclone --config "$RCLONE_CONF" copy "$PG_DUMP" "b2:${B2_BUCKET}/nightly/"

if [ "$DOW" = "7" ]; then
  echo "== 3b. Weekly snapshot (Sunday) =="
  WEEK_DUMP="$TMP/kiba-pg-${WEEK}.dump"
  cp "$PG_DUMP" "$WEEK_DUMP"
  rclone --config "$RCLONE_CONF" copy "$WEEK_DUMP" "b2:${B2_BUCKET}/weekly/"
fi

echo "== 4. Heartbeat =="
if [ -n "${UPTIME_KUMA_HEARTBEAT_URL:-}" ]; then
  curl -fsS "$UPTIME_KUMA_HEARTBEAT_URL" >/dev/null
fi

echo "Backup ${DATE} OK"
