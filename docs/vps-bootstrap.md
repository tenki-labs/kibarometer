# VPS bootstrap runbook (Phase 7)

A one-time set-up to make `193.200.238.120` ready for kibarometer
deploys. Run by a teammate with VPS sudo. Claude can't touch the VPS.

The deploy pipeline itself (push to `main` → CI builds + rolls out) lands
in **Phase 8** — this runbook gets you to the point where Phase 8 has
something to deploy onto.

## Pre-conditions

The VPS already runs `tenki.no`, so these are assumed in place:

- Docker + docker-compose, UFW, the `deploy` user
- A shared edge at `/opt/edge/` (Caddy) — kibarometer writes a routing
  fragment to `/opt/edge/sites/kibarometer.caddy` per scaffolding §6.11,
  done by `deploy.sh` in Phase 8
- DNS for `kibarometer.no` and `www.kibarometer.no` pointing to
  `193.200.238.120` (do this before Phase 10 / go-live; not required
  for bootstrap)

## Step-by-step

### 1. Get the repo onto the VPS

```bash
ssh deploy@193.200.238.120
mkdir -p /opt/kibarometer/incoming
# From your laptop, in another shell:
git clone --depth=1 https://github.com/tenki-labs/kibarometer.git /tmp/kiba
scp -r /tmp/kiba/. deploy@193.200.238.120:/opt/kibarometer/incoming/
```

(Phase 8 does this for you on every push. For Phase 7 you have to seed
it once by hand.)

### 2. Provision dirs + the kiba Docker network

```bash
ssh deploy@193.200.238.120
sudo bash /opt/kibarometer/incoming/scripts/bootstrap.sh
```

Creates `/opt/kibarometer/{website,admin,env,data/postgres,backups,build,incoming}`
owned by `deploy:deploy`, plus the `kiba` Docker network.

### 3. Mint secrets + drop env files

```bash
sudo bash /opt/kibarometer/incoming/scripts/generate-secrets.sh
```

Writes (all mode 600, owner `deploy:deploy`):

- `/opt/kibarometer/env/supabase.env` — POSTGRES_PASSWORD, JWT_SECRET,
  ANON_KEY, SERVICE_ROLE_KEY, dashboard creds, etc. Seeded from
  `docker/supabase/.env.example` then patched.
- `/opt/kibarometer/env/admin.env` — admin's runtime env (PORT, kong URL,
  service-role key, JWT secret, FETCHER_TOKEN, redis URL).
- `/opt/kibarometer/env/fetcher.env` — FETCHER_TOKEN + ADMIN_URL only.
- `/opt/kibarometer/env/.env.production` — NEXT_PUBLIC_* for the
  marketing site.

The script refuses to clobber existing files. To regenerate any of them,
move the existing one aside first.

> **Save these somewhere outside the VPS.** Once written they're the only
> copy. `cat /opt/kibarometer/env/admin.env` and store in a password
> manager.

### 4. Stage the compose files

```bash
sudo cp /opt/kibarometer/incoming/compose.yml \
        /opt/kibarometer/incoming/compose.boot.yml \
        /opt/kibarometer/incoming/compose.prod.yml \
        /opt/kibarometer/website/
sudo cp -r /opt/kibarometer/incoming/docker/supabase \
        /opt/kibarometer/website/docker/
sudo chown -R deploy:deploy /opt/kibarometer/website
```

(Phase 8's `deploy.sh` does this on every push. Once that's in, this step
becomes automatic.)

### 5. Start the supabase fleet

```bash
sudo bash /opt/kibarometer/incoming/scripts/bootstrap.sh --bring-up
```

Brings up `kiba-supabase-{db,kong,auth,rest,meta,studio}` with mem caps
from `compose.prod.yml`. Waits for Kong healthy and restarts auth once
to force its internal migrations (same gotcha local-dev solved).

Confirm:

```bash
docker ps --format '{{.Names}}\t{{.Status}}' | grep '^kiba-'
# Expect 6 supabase containers, all (healthy).
```

### 6. Apply the migrations

The supabase fleet is up but empty. Apply the schema we have so far
(0001 baseline, 0002 nav_raw, 0005 jobs):

```bash
PGPW=$(grep '^POSTGRES_PASSWORD=' /opt/kibarometer/env/supabase.env | cut -d= -f2)
for m in /opt/kibarometer/incoming/supabase/migrations/00*.sql; do
  echo "applying $(basename "$m")"
  docker exec -i -e PGPASSWORD="$PGPW" kiba-supabase-db \
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$m"
done
```

(Phase 8's `deploy.sh` does this on every push too.)

### 7. Mint the first super_admin user

No GoTrue email signup is enabled (`DISABLE_SIGNUP=true`). The first
admin user is inserted directly via SQL:

```bash
PGPW=$(grep '^POSTGRES_PASSWORD=' /opt/kibarometer/env/supabase.env | cut -d= -f2)
docker exec -i -e PGPASSWORD="$PGPW" kiba-supabase-db psql -U postgres -d postgres <<'SQL'
-- One-shot insert. NO `on conflict (email)` — auth.users.email has a partial
-- unique index (where deleted_at is null), not a true unique constraint, so
-- ON CONFLICT (email) is rejected. If you re-run this on an existing email,
-- it errors loudly — which is fine for a bootstrap-once flow.
insert into auth.users (instance_id, id, email, encrypted_password, role, aud, email_confirmed_at,
                        raw_user_meta_data)
values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(),
        'oscar@winsights.no',
        crypt('REPLACE_ME', gen_salt('bf')),
        'authenticated', 'authenticated', now(),
        '{"full_name": "Oscar", "role": "super_admin"}'::jsonb);
-- Backfill public.profiles. The on_auth_user_created trigger fires above
-- and inserts the profile row, so this insert is usually a no-op (caught by
-- on conflict (id)). Kept defensive in case the trigger is ever disabled.
insert into public.profiles (id, full_name, role)
select id,
       coalesce(raw_user_meta_data->>'full_name', email),
       coalesce(raw_user_meta_data->>'role', 'employee')
from auth.users
on conflict (id) do nothing;
SQL
```

Replace `REPLACE_ME` with a strong password (and store it). After Phase
3's admin login flow lands a deploy, log in at
`https://kibarometer.no/admin/login`.

### 8. Configure GitHub secrets (for Phase 8)

In the `tenki-labs/kibarometer` repo, add these Actions secrets:

| Name | Value |
|---|---|
| `SSH_PRIVATE_KEY` | The deploy key whose public half is in `/home/deploy/.ssh/authorized_keys` on the VPS |
| `SSH_KNOWN_HOSTS` | Output of `ssh-keyscan 193.200.238.120` |
| `VPS_HOST` | `193.200.238.120` |
| `VPS_USER` | `deploy` |

### 9. Verify the supabase fleet survives a reboot

```bash
sudo reboot
# Wait, then ssh back in.
docker ps --format '{{.Names}}\t{{.Status}}' | grep '^kiba-supabase-' | wc -l
# 6
```

`restart: unless-stopped` does the work — no systemd unit needed.

## What's still missing after Phase 7

- **`scripts/deploy.sh`** + the GitHub Actions workflow — Phase 8.
  Without these, code changes need a manual deploy: scp from laptop,
  rebuild the `kiba-web` image on the VPS, sync admin sources into
  `/opt/kibarometer/admin/`, `docker compose up -d --force-recreate web admin`.
- **`/opt/edge/sites/kibarometer.caddy`** — Phase 8 (`deploy.sh` writes
  it on each deploy). Until then, kibarometer.no doesn't route anywhere.
- **Backups** — Phase 10.

## Troubleshooting

**`bootstrap.sh --bring-up` says compose files missing**
You skipped step 4. Stage the compose files into
`/opt/kibarometer/website/` then re-run.

**Login fails with `Database error querying schema`**
GoTrue's internal migrations didn't run. Bootstrap's auth-restart fix
should handle this — if it didn't, manually `docker restart
kiba-supabase-auth` and wait for healthy.

**`is_staff()` returns false for the admin user**
Step 7's profile backfill was skipped. Re-run the second `insert into
public.profiles` block.

**Studio at `localhost:8000` returns 401**
Studio uses Basic auth. Check `DASHBOARD_USERNAME` /
`DASHBOARD_PASSWORD` in `/opt/kibarometer/env/supabase.env`.
