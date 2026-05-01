#!/bin/sh
# scripts/fetcher-entrypoint.sh
# Entrypoint for the kiba-fetcher alpine sidecar. Renders fetcher-crontab with
# env vars expanded (so cron has the bearer token + admin URL baked in), then
# starts crond in the foreground.
set -eu

apk add --no-cache curl tzdata >/dev/null 2>&1 || true

: "${FETCHER_TOKEN:?FETCHER_TOKEN env var required}"
: "${ADMIN_URL:?ADMIN_URL env var required}"

# Expand ${FETCHER_TOKEN} and ${ADMIN_URL} in the crontab template.
# Other env vars are left as literal text (envsubst would also expand them,
# but our template only references these two so a focused sed is enough and
# avoids pulling in the gettext package).
sed \
  -e "s|\${FETCHER_TOKEN}|$FETCHER_TOKEN|g" \
  -e "s|\${ADMIN_URL}|$ADMIN_URL|g" \
  /etc/cron-template > /etc/crontabs/root

chmod 0600 /etc/crontabs/root
mkdir -p /var/log
touch /var/log/last-fetch.log

echo "kiba-fetcher: crontab installed, starting crond"
exec crond -f -l 2
