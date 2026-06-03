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

# Namespace the compose PROJECT name. This is the bug that kept biting: the
# upstream file ships `name: supabase`, and Apollo is a shared host where other
# supabase stacks also default to project `supabase`. A `compose up
# --remove-orphans` from one of those stacks then deletes OUR containers
# (kiba-supabase-db especially) as orphans of project `supabase`, killing admin
# login. Container-name namespacing alone does NOT prevent this — --remove-orphans
# keys off the project label. Force the project name to `kibarometer` so we never
# share a project namespace. (Matches compose.yml.)
sed -i -E 's|^name:[[:space:]]*supabase[[:space:]]*$|name: kibarometer|' "$F"

# Sanity check
echo "=== container_name lines ==="
grep -E '^\s*container_name:' "$F" || echo "(none)"
echo
echo "=== /opt/ paths ==="
grep -nE '/opt/' "$F" || echo "(none)"
echo
echo
echo "=== compose project name ==="
grep -nE '^name:' "$F" || echo "(none)"
echo
echo "Validate: every container_name should start with 'kiba-', every /opt/ path"
echo "should be /opt/kibarometer/, and the project name must be 'kibarometer'."

# Final hard check
if grep -qE '^\s*container_name:[[:space:]]*supabase-' "$F"; then
  echo "ERROR: at least one supabase-* container_name remains. Re-check the sed pattern." >&2
  exit 1
fi
if grep -q '/opt/tenki/' "$F"; then
  echo "ERROR: at least one /opt/tenki/ path remains." >&2
  exit 1
fi
# The project-name vector — the one that kept deleting kiba-supabase-db. A bare
# `name: supabase` (or any non-kiba project name) shares the project namespace
# with other supabase stacks on the shared host and is unsafe under their
# --remove-orphans. Fail loudly rather than ship it.
if ! grep -qE '^name:[[:space:]]*kibarometer[[:space:]]*$' "$F"; then
  echo "ERROR: compose project name is not 'kibarometer'. The upstream 'name: supabase'" >&2
  echo "       collides with other supabase stacks on the shared host and gets our" >&2
  echo "       containers removed as orphans. Re-check the project-name sed." >&2
  exit 1
fi
echo "OK — fork complete."
