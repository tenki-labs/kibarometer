#!/usr/bin/env bash
# scripts/fork-supabase-compose.sh — rewrite tenki's supabase compose for kiba.
# Container names: supabase-* → kiba-supabase-*
# Bind paths:      /opt/tenki/data/* → /opt/kibarometer/data/*
# Run from repo root once after `cp ../tenki/website/docker/supabase/docker-compose.yml docker/supabase/`.
# Idempotent.
set -euo pipefail

F=docker/supabase/docker-compose.yml
[[ -f "$F" ]] || { echo "$F not found — copy it from tenki first"; exit 1; }

# Rename containers (only on container_name lines, not service names — we keep
# service keys like `db`, `kong` so depends_on, env vars, healthcheck refs all
# still work).
sed -i \
  -e 's|^\([[:space:]]*\)container_name:[[:space:]]*supabase-|\1container_name: kiba-supabase-|g' \
  -e 's|^\([[:space:]]*\)container_name:[[:space:]]*realtime-dev\.supabase-realtime|\1container_name: kiba-supabase-realtime|g' \
  "$F"

# Repoint bind mounts
sed -i 's|/opt/tenki/data/|/opt/kibarometer/data/|g' "$F"

# Sanity check
echo "=== container_name lines ==="
grep -E '^\s*container_name:' "$F" || echo "(none)"
echo
echo "=== /opt/ paths ==="
grep -nE '/opt/' "$F" || echo "(none)"
echo
echo "Validate: every container_name should start with 'kiba-' and every /opt/ path should be /opt/kibarometer/."

# Final hard check
if grep -qE '^\s*container_name:[[:space:]]*supabase-' "$F"; then
  echo "ERROR: at least one supabase-* container_name remains. Re-check the sed pattern." >&2
  exit 1
fi
if grep -q '/opt/tenki/' "$F"; then
  echo "ERROR: at least one /opt/tenki/ path remains." >&2
  exit 1
fi
echo "OK — fork complete."
