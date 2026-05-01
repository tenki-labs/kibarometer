# kibarometer.no scaffolding blueprint — v2

> **For:** a fresh Claude Code session in an empty `kibarometer` GitHub repo.
> **Source codebase:** [tenki-labs/website](https://github.com/tenki-labs/website) (lifts and adapts).
> **Output:** a working multi-tier site (marketing Next.js + zero-dep Node admin + self-hosted Supabase + shared Caddy edge) deployable to `kibarometer.no` on the existing Tenki Labs VPS.
>
> This doc is the build plan. Read top-to-bottom on first pass. After that, jump to a section by name.

---

## 1. Reader briefing

You are bootstrapping `kibarometer.no` from an empty repo. The Tenki Labs codebase has already proven this architecture in production; your job is to reproduce its patterns — **not its business logic**.

### Hard constraints (do not negotiate)

1. **Zero npm dependencies in the admin.** Node 22 builtins only (`node:http`, `node:crypto`, `node:url`, `node:fs/promises`, native `fetch`). No `express`, `ejs`, `dotenv`, `uuid`, or `@supabase/supabase-js`. Write the small helpers yourself. The marketing Next.js side may have npm deps.
2. **Idempotent migrations.** Numbered `00NN_name.sql`. `create table if not exists`, `drop policy if exists` before `create policy`, `on conflict do nothing` on inserts. Never rewrite an applied migration — add a new one.
3. **Server-rendered HTML in admin.** Tagged-template literals (`html\`…\``, `rawHtml\`…\``). No React, no JSX in the admin Node server. The marketing site uses Next.js (React) for SEO + ISR; that's a separate process.
4. **PRG (POST-Redirect-GET) on every form.** POST handlers redirect on success. Never return HTML from a POST — it breaks SPA-nav.
5. **Conventional Commits.** `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `style:`, `test:`. Sign with `Co-Authored-By: Claude <noreply@anthropic.com>` if Claude wrote it.
6. **Never `--no-verify`, never force-push to `main`, never push without PR.**
7. **Forward motion over confirmation loops.** When direction is approved, make sensible defaults and announce them; don't serialize sub-confirmations.

### What you're integrating with

The Tenki VPS at `193.200.238.120` already runs:
- A shared Caddy edge at `/opt/edge/` (TLS termination + per-domain routing fragments)
- `tenki.no`'s full stack at `/opt/tenki/`
- A Docker daemon you'll attach new containers to

You must not:
- Touch `/opt/tenki/` paths
- Modify `/opt/edge/Caddyfile` (umbrella) or `/opt/edge/compose.yml`
- Touch `/opt/edge/data/` (root-owned by convention; Caddy state lives there)
- Reuse tenki's container names, network names, or Postgres credentials
- Share a database with tenki

You will:
- Provision `/opt/kibarometer/` (mirrors `/opt/tenki/`'s shape)
- Write only your own fragment at `/opt/edge/sites/kibarometer.caddy` (the `sites/` dir is deploy-writable; `data/` is root-only)
- Connect Caddy to your private network via `docker network connect kiba edge-caddy-1`
- Give every container a `kiba-` or `-kiba` suffix to avoid collisions
- **Fork the supabase compose** (see §6.0) before any compose `up`. Lifting it as-is from tenki will collide on container names and may mount tenki's data dirs.

---

## 2. Tech stack inventory

| Layer | Choice | Version | Notes |
|---|---|---|---|
| Runtime | Node | 22 (LTS) | Native `fetch`, ES modules, `corepack` |
| Marketing site | Next.js standalone | 15+ | Built into a single Docker image |
| Admin server | Plain `node:http` | — | ~2k LOC budget for ~10 sections is comfortable |
| Database | Postgres via self-hosted Supabase | 15.8.1.085 | RLS enforces row-level access |
| Auth | Supabase GoTrue | v2.186.0 | HS256 JWTs, email/password |
| API gateway | Kong | 3.9.1 | Sits in front of Auth/REST/Storage |
| Object storage | Supabase Storage | v1.48.26 | One private + one public bucket |
| Image transforms | imgproxy | v3.30.1 | Backed by Storage |
| Postgres GUI | Supabase Studio | latest | SSH-tunnel-only access |
| Admin DB | postgres-meta | v0.96.3 | Backs Studio |
| Edge | Caddy | 2-alpine | Shared at `/opt/edge/` (already running) |
| Container manager | Docker Compose | — | Single-VPS, no k8s |
| Marketing pkg manager | pnpm | 9+ | Lockfile committed |
| CI/CD | GitHub Actions | — | scp + ssh deploy.sh |
| Backups | rclone → Backblaze B2 | — | Nightly 03:00 cron |
| Email | Resend | — | SMTP for auth + transactional |

---

## 3. End-state architecture

### Containers (all `kiba-` prefixed to avoid collision with tenki's)

| Container | Image | Role | Network | Port |
|---|---|---|---|---|
| `kiba-web` | built | Next.js marketing | `kiba` | 3000 (internal) |
| `kiba-admin` | `node:22-alpine` | Admin Node | `kiba` | 4000 (internal) |
| `kiba-redis` | `redis:7-alpine` | Rate limiting + cache | `kiba` | 6379 (internal) |
| `kiba-supabase-db` | `supabase/postgres:15.8.1.085` | Postgres 15 | `kiba` | 5432 (bound to 127.0.0.1) |
| `kiba-supabase-kong` | `kong/kong:3.9.1` | API gateway | `kiba` | 8000 (internal) |
| `kiba-supabase-auth` | `supabase/gotrue:v2.186.0` | Email/password auth | `kiba` | 9999 (internal) |
| `kiba-supabase-rest` | `postgrest/postgrest:v14.8` | PostgREST | `kiba` | 3000 (internal) |
| `kiba-supabase-storage` | `supabase/storage-api:v1.48.26` | File buckets | `kiba` | 5000 (internal) |
| `kiba-supabase-imgproxy` | `darthsim/imgproxy:v3.30.1` | Image transforms | `kiba` | 5001 (internal) |
| `kiba-supabase-meta` | `supabase/postgres-meta:v0.96.3` | Studio backend | `kiba` | 8080 (internal) |
| `kiba-supabase-studio` | `supabase/studio:latest` | Postgres GUI (SSH-only) | `kiba` | 3000 (internal) |
| `kiba-backup-1` | `alpine:3.20` | Nightly B2 backups | `kiba` | — |
| `edge-caddy-1` | (shared with tenki) | TLS edge | `edge_net + kiba` | 80, 443 (host) |

> **Important:** the supabase upstream compose file you'll lift from tenki hardcodes container names as `supabase-db`, `supabase-kong`, etc. (no `kiba-` prefix). §6.0 is the rewrite step that produces the `kiba-supabase-*` names listed above. **Don't skip it.**

### Networks

- **`kiba`** — private to kibarometer. All your containers join. Tenki's containers cannot reach it.
- **`edge_net`** — pre-existing, shared. Caddy joins this. Your `kiba-web`, `kiba-admin`, `kiba-supabase-kong` will be reached by Caddy after `docker network connect kiba edge-caddy-1` runs in your deploy.

Caddy is the only container on multiple networks. That doesn't bridge them — Tenki's services on `tenki` network still cannot reach yours on `kiba`.

### VPS file layout (you create `/opt/kibarometer/` in Phase 7)

```
/opt/kibarometer/
├── website/              ← repo checkout (deploy.sh updates from incoming/)
├── admin/                ← bind-mounted into kiba-admin (server.js + sections/)
├── env/                  ← secrets, mode 600, owner deploy:deploy
│   ├── supabase.env
│   ├── admin.env
│   ├── .env.production   ← Next.js build-time
│   └── backup.env
├── data/
│   ├── postgres/         ← Postgres PGDATA (mounted into kiba-supabase-db AFTER §6.0 rewrite)
│   └── storage/          ← Supabase Storage objects
├── backups/              ← nightly tarballs before B2 upload
├── build/                ← archived deploys (last 5)
└── incoming/             ← scp target from GH Actions
```

### Public routing

`kibarometer.no` → `edge-caddy-1` → reads `/opt/edge/sites/kibarometer.caddy` → routes:

| Pattern | Upstream |
|---|---|
| `/admin`, `/admin/*` | `kiba-admin:4000` |
| `/api/*` (yours) | `kiba-admin:4000` |
| `/supabase/*` | `kiba-supabase-kong:8000` (strip prefix) |
| everything else | `kiba-web:3000` |

---

## 4. Repository layout

```
kibarometer/
├── app/                              ← Next.js marketing
│   ├── layout.tsx
│   ├── page.tsx
│   ├── healthz/route.ts
│   └── globals.css
├── lib/                              ← marketing helpers
│   └── env.ts                        ← zod-validated env
├── scripts/
│   ├── admin-server.js               ← admin entry (zero deps)
│   ├── admin-sections/
│   │   ├── shared.js                 ← helpers (esc, btn, sbFetch wiring, …)
│   │   └── notes.js                  ← canonical section example
│   ├── deploy.sh                     ← VPS deploy
│   ├── bootstrap.sh                  ← one-time VPS provisioning (also brings up supabase fleet first run)
│   ├── backup.sh                     ← nightly cron in backup container
│   ├── generate-secrets.sh           ← initial secret minting
│   ├── mint-jwt.mjs                  ← JWT minter (used by setup, deploy)
│   └── fork-supabase-compose.sh      ← §6.0 rewrite step (committed once, but kept around for re-runs)
├── supabase/migrations/
│   └── 0001_baseline.sql             ← profiles, RLS helpers
├── docker/
│   ├── web.Dockerfile                ← Next.js standalone build
│   ├── supabase/docker-compose.yml   ← Supabase fleet — committed AFTER §6.0 rewrite, never lifted as-is
│   └── edge/sites/kibarometer.caddy  ← THIS site's edge fragment
├── compose.yml                       ← base
├── compose.boot.yml                  ← admin + web overrides
├── compose.prod.yml                  ← prod memory caps
├── local-dev/
│   ├── setup.sh
│   ├── compose.yml
│   ├── mint-jwt.mjs
│   └── create-admin-user.mjs
├── .github/workflows/
│   ├── ci.yml
│   └── deploy.yml
├── .gitignore
├── .gitleaks.toml
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── eslint.config.mjs
├── playwright.config.ts
├── vitest.config.ts
├── CLAUDE.md                         ← the new repo's playbook (template in §10)
└── README.md
```

---

## 5. Phased build sequence

Execute one phase at a time. Verify each before moving on.

### Phase 0 — repo init

- `git init` (already done by user — repo is empty)
- Add `.gitignore` (Node, Next.js, OS, env files):

```gitignore
node_modules/
.next/
out/
dist/
.env
.env.local
.env.production
local-dev/.env
local-dev/data/
local-dev/secrets/
.DS_Store
*.log
.vscode/
```

- Add `.gitleaks.toml` (block accidental secret commits — copy tenki's pattern)
- Add `package.json` with these scripts:

```json
{
  "name": "kibarometer",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "lhci": "lhci autorun"
  },
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@playwright/test": "^1.48.0",
    "eslint": "^9.13.0",
    "eslint-config-next": "^15.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- Write a placeholder `CLAUDE.md` (full template in §10 — you can write the final version after Phase 8)
- Write a minimal `README.md` (one paragraph)

**Verify:** `git status` shows tracked files; `pnpm install` succeeds.

### Phase 0.5 — fork the supabase compose (NEW; do this before any compose use)

See §6.0. Fetch tenki's `docker/supabase/docker-compose.yml`, run `scripts/fork-supabase-compose.sh` once to rewrite container names + bind-mount paths, commit the result. Do not commit the unrewritten upstream — there is no scenario in which it should land on disk in this repo.

**Verify:** `grep -E 'container_name:|/opt/' docker/supabase/docker-compose.yml` shows only `kiba-*` names and only `/opt/kibarometer/` paths. No `supabase-*` (without `kiba-` prefix). No `/opt/tenki/`.

### Phase 1 — local-dev pod

Stand up the Supabase + admin pod on your laptop *before* writing app code, so subsequent phases have a real database. See §6 for `local-dev/setup.sh` and friends. After bring-up:

- Postgres reachable on `localhost:5432`
- Admin login at `http://localhost:4000/admin/login` with seeded super_admin

**Verify:** `./local-dev/setup.sh` exits 0; `curl http://localhost:4000/admin/health` returns `{"ok":true}`; can log in.

### Phase 2 — first migration

Write `supabase/migrations/0001_baseline.sql` (full template in §6). Apply via local-dev:

```bash
PGPW=$(grep -E '^POSTGRES_PASSWORD=' local-dev/.env | cut -d= -f2)
docker exec -i -e PGPASSWORD="$PGPW" kiba-supabase-db \
  psql -U postgres -d postgres < supabase/migrations/0001_baseline.sql
```

**Verify:** `\dt public.*` in psql lists `profiles`; `select is_staff();` returns true for the super_admin you seeded.

### Phase 3 — admin Node skeleton

Write `scripts/admin-server.js` and `scripts/admin-sections/shared.js`. Bind-mount into `kiba-admin` (already configured in `compose.boot.yml` from Phase 1). Routes that must work:

- `GET /admin/health` → `{"ok":true}`
- `GET /admin/login` → form
- `POST /admin/login` → set cookie, redirect to dashboard
- `POST /admin/logout` → clear cookie, redirect to login
- `GET /admin` → dashboard placeholder (post-auth)

**Verify:** Login flow works in browser; SPA-nav script intercepts sidebar links; flash messages appear after `?flash_ok=...`.

### Phase 4 — first admin section (notes)

Write `scripts/admin-sections/notes.js` as a CRUD example over a `notes` table (add a migration `0002_notes.sql`). Demonstrates list/detail/form/POST patterns, sbFetch with both modes, PRG redirect.

**Verify:** Can create, list, edit, delete notes through the admin UI. Flash messages confirm each.

### Phase 5 — Next.js marketing

Write `app/layout.tsx`, `app/page.tsx`, `app/healthz/route.ts`, `lib/env.ts`. Pick provisional design tokens (you'll refine later); start from a 1-page hello-world and grow from there.

**Verify:** `pnpm build` succeeds with all `NEXT_PUBLIC_*` vars in `.env.local`; `curl localhost:3000/healthz` returns 200.

### Phase 6 — Docker + compose

Write `docker/web.Dockerfile`, `compose.yml`, `compose.boot.yml`, `compose.prod.yml`. The supabase compose is already done (Phase 0.5). Test:

```bash
docker compose -f compose.yml -f compose.boot.yml -f docker/supabase/docker-compose.yml up -d
```

**Verify:** All containers reach "healthy" status; admin and web answer healthchecks; Supabase Studio reachable via SSH tunnel pattern.

### Phase 7 — VPS bootstrap (one-time)

`scripts/bootstrap.sh` provisions `/opt/kibarometer/` on the existing VPS **and brings up the Supabase fleet for the first time** (without this, deploy.sh's selective `up -d web admin` won't start auth/rest/storage/etc.). Skip global steps already done for tenki (Docker install, UFW). The deploy user already exists.

**Manual on the VPS** (your teammate runs this once):

```bash
sudo bash /tmp/bootstrap.sh   # scp it up first
# Then drop env files manually (see §6.13 for the env keys you need):
sudo install -d -o deploy -g deploy /opt/kibarometer/env
sudo install -m 600 -o deploy -g deploy /dev/stdin /opt/kibarometer/env/supabase.env <<EOF
POSTGRES_PASSWORD=<generated>
JWT_SECRET=<generated>
ANON_KEY=<minted>
SERVICE_ROLE_KEY=<minted>
RESEND_API_KEY=<your_key>
SMTP_HOST=smtp.resend.com
# ... etc
EOF
# Then re-run bootstrap.sh once more — it'll detect env present, scp the
# repo to /opt/kibarometer/incoming/, and bring up the supabase fleet.
sudo bash /tmp/bootstrap.sh --bring-up
```

**Verify:** `/opt/kibarometer/{website,admin,env,data,backups,build,incoming}` exists; secrets are mode 600 owner deploy:deploy; `docker ps | grep kiba-supabase-` shows all 8 supabase containers running and healthy.

### Phase 8 — deploy pipeline

Write `.github/workflows/deploy.yml`, `.github/workflows/ci.yml`, `scripts/deploy.sh`. Configure GitHub secrets: `SSH_PRIVATE_KEY`, `SSH_KNOWN_HOSTS`, `VPS_HOST`, `VPS_USER`. Push to `main` triggers deploy.

**Verify:** First deploy completes; `https://kibarometer.no/` returns 200 (after DNS); `https://kibarometer.no/admin/login` returns 200; `tenki.no` still works (no regression).

### Phase 9 — backups

Write `scripts/backup.sh`. Add `kiba-backup-1` service to compose. Configure B2 bucket (or shared bucket with `kiba/` prefix). Cron in container at 03:00.

**Verify:** Manually trigger via `docker exec kiba-backup-1 /backup.sh`; check B2 for the dump; confirm Uptime Kuma heartbeat (if configured).

### Phase 10 — DNS + go-live

Ask your teammate to point `kibarometer.no` and `www.kibarometer.no` A records → `193.200.238.120`. Caddy auto-issues a Let's Encrypt cert on first request. Done.

**Verify:** `dig kibarometer.no` returns the VPS IP; `curl -sI https://kibarometer.no/` returns 200 with valid cert.

---

## 6. Code templates

Lift these into the new repo. Where templates use `kiba`/`kibarometer.no`, those are the canonical placeholders — replace nothing; the names are intentional.

### 6.0 `scripts/fork-supabase-compose.sh` — mandatory fork step (NEW in v2)

Lift `docker/supabase/docker-compose.yml` from tenki, then run this script once to rewrite it for kibarometer. Commit the rewritten file. The script is idempotent — re-running it on an already-rewritten file is a no-op.

```bash
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
```

**After running, the supabase compose's relevant fields look like:**

```yaml
db:
  container_name: kiba-supabase-db
  volumes:
    - /opt/kibarometer/data/postgres:/var/lib/postgresql/data
    # ...
storage:
  container_name: kiba-supabase-storage
  volumes:
    - /opt/kibarometer/data/storage:/var/lib/storage
imgproxy:
  container_name: kiba-supabase-imgproxy
  volumes:
    - /opt/kibarometer/data/storage:/var/lib/storage
# ... etc for kong, auth, rest, meta, studio
```

Service keys (`db`, `kong`, `auth`, `rest`, `storage`, `imgproxy`, `meta`, `studio`) stay unchanged — only the `container_name:` line and bind mounts are rewritten.

### 6.1 `scripts/admin-sections/shared.js` — admin helpers

```javascript
// scripts/admin-sections/shared.js
// Shared helpers for admin sections. Zero deps, Node 22 builtins only.

export const esc = (v) => String(v ?? "").replace(/[<>&"']/g, (c) => ({
  "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;"
}[c]));

export function html(strings, ...values) {
  return strings.reduce((acc, s, i) => acc + s + (values[i] === undefined ? "" : esc(values[i])), "");
}
export function rawHtml(strings, ...values) {
  return strings.reduce((acc, s, i) => acc + s + (values[i] === undefined ? "" : values[i]), "");
}

// Page header lockup: eyebrow above an h1.title. First child of every *Inner().
export const eyebrow = (text) => `<span class="eyebrow">· ${esc(text)}</span>`;
export const pageHead = (kicker, title) =>
  `<div class="titlewrap" style="margin-bottom:1.5rem">${eyebrow(kicker)}<h1 class="title" style="margin:.4rem 0 0">${esc(title)}</h1></div>`;

// Date/number formatters — adjust locale to your target market.
export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB") : "-");
export const fmtDateTime = (d) => {
  if (!d) return "-";
  const dt = new Date(d);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(dt.getDate())}.${pad(dt.getMonth() + 1)}.${dt.getFullYear()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
};

export function initials(name) {
  if (!name) return "·";
  const parts = String(name).split(/[\s@]+/).filter(Boolean);
  return ((parts[0] || "")[0] || "").concat(((parts[1] || "")[0] || "")).toUpperCase() || "·";
}

// Optional-field normalizers — use in POST handlers before sbFetch.
export function nullIfEmpty(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
export function intOrNull(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}
export function floatOrNull(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = parseFloat(v);
  return Number.isNaN(n) ? null : n;
}

// Flash via query string.
export function parseFlash(url) {
  const ok = url.searchParams.get("flash_ok");
  const err = url.searchParams.get("flash_error");
  if (!ok && !err) return undefined;
  return { ok: ok || undefined, error: err || undefined };
}
export function flashQs({ ok, error }) {
  const qs = new URLSearchParams();
  if (ok) qs.set("flash_ok", ok);
  if (error) qs.set("flash_error", error);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

// Pill button. Render every CTA through this — never hand-write `class="btn"`.
// Variants: "primary" (fill, default) | "ghost" (transparent + 1px border)
// Sizes: "default" | "small"
// Pass href to render <a> instead of <button>. confirm: "..." attaches onclick confirm.
export function btn(opts = {}) {
  const {
    label = "",
    type = "submit",
    variant = "primary",
    size = "default",
    href,
    name,
    value,
    formaction,
    formmethod,
    confirm,
    ariaLabel,
    extraAttrs = "",
  } = opts;
  const cls = `btn ${variant === "ghost" ? "ghost" : ""} ${size === "small" ? "small" : ""}`.trim();
  const aria = ariaLabel ? ` aria-label="${esc(ariaLabel)}"` : "";
  const conf = confirm ? ` onclick="return confirm('${esc(confirm).replace(/'/g, "\\'")}')"` : "";
  const extra = extraAttrs ? " " + extraAttrs : "";
  if (href !== undefined) {
    return `<a href="${esc(href)}" class="${cls}"${aria}${conf}${extra}>${esc(label)}</a>`;
  }
  const attrs = [
    `type="${esc(type)}"`,
    `class="${cls}"`,
    name ? `name="${esc(name)}"` : "",
    value !== undefined ? `value="${esc(value)}"` : "",
    formaction ? `formaction="${esc(formaction)}"` : "",
    formmethod ? `formmethod="${esc(formmethod)}"` : "",
    aria, conf, extra,
  ].filter(Boolean).join(" ");
  return `<button ${attrs}>${esc(label)}</button>`;
}
```

### 6.2 `scripts/admin-server.js` — admin entry (skeleton)

This is the load-bearing 200-line core. Tenki's full version is ~3000 LOC because it has 16 sections; you start with one. Add sections incrementally.

```javascript
// scripts/admin-server.js
// kibarometer admin — auth via self-hosted Supabase, sidebar UI, sections via PostgREST.
// Zero npm deps (Node 22 builtins only).
import { createServer } from "node:http";
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { URL } from "node:url";
import * as Notes from "./sections/notes.js";
import { btn, parseFlash, flashQs } from "./sections/shared.js";

const PORT = Number(process.env.PORT || 4000);
const SUPABASE_URL = process.env.SUPABASE_INTERNAL_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
const NODE_ENV = process.env.NODE_ENV || "development";

for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET })) {
  if (!v) { console.error(`Missing env: ${k}`); process.exit(1); }
}

// ---------- JWT verify (HS256, no SDK) ----------
function b64urlToBuf(s) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}
function verifySupabaseJwt(token) {
  if (!token) return null;
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;
  const expected = createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url");
  const a = Buffer.from(s), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(b64urlToBuf(p).toString("utf8"));
    if (typeof claims.exp === "number" && claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch { return null; }
}

// ---------- Cookies + body ----------
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    out[k] = v.join("=");
  }
  return out;
}
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  const ct = req.headers["content-type"] || "";
  if (ct.includes("application/json")) { try { return JSON.parse(raw); } catch { return {}; } }
  const params = new URLSearchParams(raw);
  const out = {};
  for (const [k, v] of params) {
    if (k in out) {
      if (Array.isArray(out[k])) out[k].push(v); else out[k] = [out[k], v];
    } else out[k] = v;
  }
  return out;
}

// ---------- PostgREST client ----------
async function sbFetch(path, { token, service = false, method = "GET", body, headers = {}, prefer } = {}) {
  const apikey = service ? SUPABASE_SERVICE_ROLE_KEY : SUPABASE_ANON_KEY;
  const authToken = service ? SUPABASE_SERVICE_ROLE_KEY : token;
  const h = {
    apikey,
    Authorization: `Bearer ${authToken}`,
    "Content-Type": "application/json",
    ...headers,
  };
  if (prefer) h.Prefer = prefer;
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method, headers: h, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  if (!res.ok) {
    const msg = (data && data.message) || text || res.statusText;
    throw new Error(`PostgREST ${method} ${path} → ${res.status}: ${msg}`);
  }
  return data;
}

// ---------- Layout (returns full HTML page) ----------
const SPA_NAV_SCRIPT = `<script>
(function(){
  if (!history.pushState) return;
  function isInternal(a){ return a && a.href && a.origin === location.origin && a.dataset.adminLink === "true"; }
  document.addEventListener("click", function(e){
    var a = e.target.closest("a"); if (!isInternal(a)) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    swap(a.href);
  });
  document.addEventListener("submit", function(e){
    var f = e.target;
    if (!f.matches("main form[method=post]")) return;
    e.preventDefault();
    var fd = new FormData(f);
    fetch(f.action || location.href, { method: "POST", body: fd, redirect: "follow", credentials: "same-origin" })
      .then(function(r){ swap(r.url); });
  });
  function swap(url){
    fetch(url, { credentials: "same-origin" }).then(r => r.text()).then(function(html){
      var doc = new DOMParser().parseFromString(html, "text/html");
      var newMain = doc.querySelector("main");
      if (newMain) document.querySelector("main").replaceWith(newMain);
      history.pushState({}, "", url);
      document.body.removeAttribute("data-first-load");
      window.scrollTo(0, 0);
    });
  }
  window.addEventListener("popstate", function(){ swap(location.href); });
})();
</script>`;

const CSS = `
:root {
  --bg: #FAFAFA; --ink: #0F0F12; --accent: #1A4DFF;
  --muted: #6E6E76; --subtle: #E2E2E2; --surface: #F0F0F0;
}
* { box-sizing: border-box; border-radius: 0; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.5 "DM Sans", system-ui, sans-serif; }
.layout { display: grid; grid-template-columns: 224px 1fr; min-height: 100vh; }
.sidebar { background: var(--surface); border-right: 1px solid var(--subtle); padding: 1.25rem 1rem; }
.sidebar nav a { display: block; padding: .4rem .6rem; color: var(--ink); text-decoration: none; font: 500 .72rem/1 "DM Mono", monospace; text-transform: uppercase; letter-spacing: .18em; }
.sidebar nav a[aria-current=page] { box-shadow: inset 2px 0 0 var(--accent); }
main { padding: 1.5rem 2rem; max-width: 1200px; }
.title { font-weight: 500; letter-spacing: -0.02em; font-size: 1.75rem; margin: 0; }
.eyebrow { font: 500 .68rem/1 "DM Mono", monospace; text-transform: uppercase; letter-spacing: .22em; color: var(--muted); }
.btn { display: inline-block; padding: .55rem 1.1rem; background: var(--ink); color: white; border: 1px solid var(--ink); cursor: pointer;
       border-radius: 9999px; font: 500 .7rem/1 "DM Mono", monospace; text-transform: uppercase; letter-spacing: .14em; text-decoration: none; }
.btn.ghost { background: transparent; color: var(--ink); }
.btn.small { padding: .35rem .8rem; font-size: .65rem; }
.card { background: white; border: 1px solid var(--subtle); padding: 1rem 1.25rem; }
.ok { background: #E6F4EA; border-left: 3px solid #0F8F3C; padding: .65rem 1rem; margin-bottom: 1rem; }
.err { background: #FCE8E6; border-left: 3px solid #B83A2A; padding: .65rem 1rem; margin-bottom: 1rem; }
.empty { color: var(--muted); padding: 2rem; text-align: center; }
input, select, textarea { padding: .55rem .8rem; border: 1px solid var(--subtle); background: white; font: inherit; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: .65rem .85rem; text-align: left; border-bottom: 1px solid var(--subtle); }
th { font: 500 .68rem/1 "DM Mono", monospace; text-transform: uppercase; letter-spacing: .18em; color: var(--muted); }
`;

const NAV = [
  ["/admin", "Dashboard"],
  ["/admin/notes", "Notes"],
];

async function layout(path, claims, inner, flash) {
  const navHtml = NAV.map(([href, label]) => {
    const active = path === href || path.startsWith(href + "/");
    return `<a href="${href}" data-admin-link="true"${active ? ' aria-current="page"' : ""}>${label}</a>`;
  }).join("");
  const flashHtml = flash
    ? (flash.ok ? `<div class="ok">${flash.ok}</div>` : "") + (flash.error ? `<div class="err">${flash.error}</div>` : "")
    : "";
  return `<!doctype html><html><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>kibarometer admin</title>
    <style>${CSS}</style>
  </head><body data-first-load="true">
    <div class="layout">
      <aside class="sidebar"><div class="eyebrow" style="margin-bottom:1rem">kibarometer</div><nav>${navHtml}</nav></aside>
      <main>${flashHtml}${inner}</main>
    </div>
    ${SPA_NAV_SCRIPT}
  </body></html>`;
}

// ---------- Pages ----------
function loginPage({ error } = {}) {
  return `<!doctype html><html><head><title>Login</title><style>${CSS}</style></head>
    <body><main style="max-width:420px;margin:8vh auto">
      <h1 class="title" style="margin-bottom:1rem">Sign in</h1>
      ${error ? `<div class="err">${error}</div>` : ""}
      <form method="post" action="/admin/login" class="stack">
        <label>Email<input type="email" name="email" required autofocus></label>
        <label style="display:block;margin-top:.85rem">Password<input type="password" name="password" required></label>
        <div style="margin-top:1.2rem">${btn({ label: "Sign in" })}</div>
      </form>
    </main></body></html>`;
}

async function loginSubmit(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.access_token || null;
}

// ---------- Server ----------
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.sb_access_token;
  const claims = verifySupabaseJwt(token);
  const flash = parseFlash(url);
  const send = (status, body, extraHeaders = {}) => {
    res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", ...extraHeaders });
    res.end(body);
  };
  const sendPage = async (inner) => send(200, await layout(path, claims, inner, flash));
  const redirect = (loc) => { res.writeHead(302, { Location: loc }); res.end(); };

  try {
    if (path === "/admin/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true }));
    }

    if (path === "/admin/login" && req.method === "GET") return send(200, loginPage());
    if (path === "/admin/login" && req.method === "POST") {
      const body = await readBody(req);
      const t = await loginSubmit(body.email, body.password);
      if (!t) return send(401, loginPage({ error: "Invalid credentials" }));
      return redirect("/admin", { "Set-Cookie": `sb_access_token=${t}; Path=/; HttpOnly; SameSite=Lax${NODE_ENV === "production" ? "; Secure" : ""}` });
    }
    if (path === "/admin/logout" && req.method === "POST") {
      res.writeHead(302, { Location: "/admin/login", "Set-Cookie": "sb_access_token=; Path=/; HttpOnly; Max-Age=0" });
      return res.end();
    }

    if (path.startsWith("/admin") && !claims) return redirect("/admin/login");

    if (path === "/admin") return sendPage(`<h1 class="title">Dashboard</h1><p class="eyebrow">welcome ${claims?.email || ""}</p>`);

    // Notes section
    if (path === "/admin/notes" && req.method === "GET")
      return sendPage(await Notes.listInner({ sb: sbFetch, url, flash, claims }));
    if (path === "/admin/notes" && req.method === "POST") {
      const body = await readBody(req);
      const id = await Notes.create({ sb: sbFetch, body, claims });
      return redirect(`/admin/notes${flashQs({ ok: "Note created" })}`);
    }

    return send(404, "<h1>Not found</h1>");
  } catch (err) {
    console.error(err);
    return send(500, `<h1>Error</h1><pre>${err.message}</pre>`);
  }
});

server.listen(PORT, () => console.log(`admin listening on :${PORT}`));
```

### 6.3 `scripts/admin-sections/notes.js` — canonical section example

```javascript
// scripts/admin-sections/notes.js
import { esc, rawHtml, fmtDateTime, btn, nullIfEmpty, pageHead } from "./shared.js";

export async function listInner({ sb, url, flash, claims }) {
  const rows = await sb(`/notes?select=id,content,created_at&order=created_at.desc&limit=50`, { service: true });
  return rawHtml`
    ${pageHead("admin", "Notes")}
    <div class="card">
      <form method="post" action="/admin/notes" class="stack">
        <textarea name="content" rows="3" required placeholder="Write something..."></textarea>
        <div style="margin-top:.6rem">${btn({ label: "Add note" })}</div>
      </form>
    </div>
    <div class="card" style="margin-top:1.25rem">
      ${rows.length === 0
        ? '<div class="empty">No notes yet.</div>'
        : `<table><thead><tr><th>Content</th><th>Created</th></tr></thead><tbody>
            ${rows.map(r => `<tr>
              <td>${esc(r.content)}</td>
              <td>${fmtDateTime(r.created_at)}</td>
            </tr>`).join("")}
          </tbody></table>`}
    </div>
  `;
}

export async function create({ sb, body, claims }) {
  const content = nullIfEmpty(body.content);
  if (!content) throw new Error("content required");
  const [row] = await sb(`/notes`, {
    service: true, method: "POST",
    body: { content, author_id: claims?.sub },
    prefer: "return=representation",
  });
  return row.id;
}
```

### 6.4 `lib/env.ts` — Next.js env validation (zod)

```typescript
// lib/env.ts
import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_SITE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_INTERNAL_URL: z.string().url(),
  RESEND_API_KEY: z.string().min(1).optional(),
});

export type Env = z.infer<typeof schema>;

export function createEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return Object.freeze(parsed.data);
}

let cached: Env | undefined;
export const env: Env = new Proxy({} as Env, {
  get(_, key: string) {
    if (!cached) cached = createEnv();
    return cached[key as keyof Env];
  },
});
```

### 6.5 `local-dev/mint-jwt.mjs` — JWT minter (verbatim)

```javascript
#!/usr/bin/env node
// Mint a Supabase HS256 JWT. Pure node:crypto, no deps.
// Usage:  JWT_SECRET=<secret> node local-dev/mint-jwt.mjs anon
//         JWT_SECRET=<secret> node local-dev/mint-jwt.mjs service_role
import { createHmac } from "node:crypto";

const role = process.argv[2];
if (role !== "anon" && role !== "service_role") {
  console.error("Role must be 'anon' or 'service_role'");
  process.exit(1);
}
const secret = process.env.JWT_SECRET;
if (!secret) { console.error("JWT_SECRET required"); process.exit(1); }

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
const payload = b64url(JSON.stringify({
  role,
  iss: "supabase",
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365 * 10,
}));
const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
process.stdout.write(`${header}.${payload}.${signature}`);
```

### 6.6 `supabase/migrations/0001_baseline.sql` — schema baseline

```sql
-- 0001_baseline.sql
-- Profiles + role helpers + auth-driven profile insert trigger.
-- Idempotent: re-running is safe.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'employee'
    check (role in ('super_admin', 'admin', 'employee', 'read_only')),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create or replace function public.trigger_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists profiles_updated_at on profiles;
create trigger profiles_updated_at before update on profiles
  for each row execute function trigger_set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email),
          coalesce(new.raw_user_meta_data->>'role', 'employee'))
  on conflict (id) do update
    set full_name = excluded.full_name, role = excluded.role;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- Role helpers (security definer)
create or replace function public.has_role(roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = any(roles));
$$;
create or replace function public.is_super_admin()
returns boolean language sql stable as $$ select has_role(array['super_admin']); $$;
create or replace function public.is_admin_or_super()
returns boolean language sql stable as $$ select has_role(array['super_admin','admin']); $$;
create or replace function public.is_staff()
returns boolean language sql stable as $$
  select has_role(array['super_admin','admin','employee','read_only']);
$$;

-- profiles RLS: staff read all, users self-update
drop policy if exists profiles_staff_read on public.profiles;
create policy profiles_staff_read on public.profiles for select using (public.is_staff());

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
```

### 6.7 `compose.yml` — base service composition

```yaml
# compose.yml
name: kibarometer

networks:
  default:
    name: kiba
  edge_net:
    external: true

volumes:
  redis_data:

services:
  web:
    container_name: kiba-web
    build:
      context: .
      dockerfile: docker/web.Dockerfile
    restart: unless-stopped
    env_file:
      - /opt/kibarometer/env/.env.production
    depends_on:
      kong: { condition: service_healthy }
      redis: { condition: service_started }
    networks: [default, edge_net]
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/healthz"]
      interval: 30s
      timeout: 3s
      retries: 3
    mem_limit: 384m

  redis:
    container_name: kiba-redis
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--save", "60", "1", "--appendonly", "no"]
    volumes:
      - redis_data:/data
    mem_limit: 64m

  backup:
    container_name: kiba-backup-1
    image: alpine:3.20
    restart: unless-stopped
    volumes:
      - ./scripts/backup.sh:/backup.sh:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /opt/kibarometer/data/storage:/data/storage:ro
    env_file:
      - /opt/kibarometer/env/backup.env
    entrypoint: ["/bin/sh", "-c"]
    command: >
      "apk add --no-cache docker-cli rclone tzdata curl &&
       echo '0 3 * * * /backup.sh' | crontab - &&
       crond -f -l 2"
    mem_limit: 64m
```

### 6.8 `compose.boot.yml` — runtime overrides

```yaml
# compose.boot.yml — admin Node + web overrides for the deployed stack.
services:
  admin:
    container_name: kiba-admin
    image: node:22-alpine
    working_dir: /app
    command: ["node", "server.js"]
    env_file:
      - /opt/kibarometer/env/admin.env
    volumes:
      - /opt/kibarometer/admin:/app:ro
    networks: [default, edge_net]
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:4000/admin/health"]
      interval: 20s
      timeout: 3s
      retries: 3
    restart: unless-stopped
    mem_limit: 128m

  web:
    image: kiba-web:latest
    build: !reset null
    environment:
      NEXT_PUBLIC_SITE_URL: https://kibarometer.no
      NODE_ENV: production
      PORT: "3000"
      HOSTNAME: "0.0.0.0"
    depends_on: !override
      admin: { condition: service_healthy }
    command: !override ["node", "server.js"]
```

### 6.9 `compose.prod.yml` — prod memory caps

```yaml
# compose.prod.yml — prod-only memory limits.
services:
  db:        { mem_limit: 768m }
  studio:    { mem_limit: 192m }
  kong:      { mem_limit: 192m }
  auth:      { mem_limit: 96m }
  rest:      { mem_limit: 96m }
  meta:      { mem_limit: 96m }
  storage:   { mem_limit: 128m }
  imgproxy:  { mem_limit: 96m }
```

### 6.10 `docker/web.Dockerfile` — Next.js standalone

```dockerfile
# docker/web.Dockerfile
FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
ARG NEXT_PUBLIC_SITE_URL=https://kibarometer.no
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 next
COPY --from=build --chown=next:nodejs /app/.next/standalone ./
COPY --from=build --chown=next:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=next:nodejs /app/public ./public
USER next
EXPOSE 3000
CMD ["node", "server.js"]
```

### 6.11 `docker/edge/sites/kibarometer.caddy` — edge fragment

> **Note (v2):** the shared `/opt/edge/Caddyfile` hardcodes `email einar@tenki.no` for the global ACME account. Let's Encrypt expiry/renewal notifications for `kibarometer.no` certs go to that address. If you want kibarometer-specific notifications, add a per-site `tls <email>` directive inside the `kibarometer.no { … }` block below.

```caddyfile
www.kibarometer.no {
    redir https://kibarometer.no{uri} 308
}

kibarometer.no {
    encode zstd gzip
    import security_headers

    # Optional: pin a kibarometer-specific ACME contact
    # tls ops@kibarometer.no

    # Admin Node — auth-gated
    @admin_paths {
        path /admin /admin/*
        path /api/admin/*
    }
    handle @admin_paths {
        reverse_proxy kiba-admin:4000
    }

    # Supabase Storage public objects + image render
    handle_path /supabase/* {
        reverse_proxy kiba-supabase-kong:8000
        header Cache-Control "public, max-age=31536000, immutable"
    }

    # Everything else → Next.js
    handle {
        reverse_proxy kiba-web:3000
    }
}
```

### 6.12 `scripts/deploy.sh` — VPS deploy

Adapted from tenki's hardened deploy.sh (smoke retry, atomic ops, idempotent edge fragment write):

```bash
#!/usr/bin/env bash
# Runs on the VPS as the deploy user. Called by GitHub Actions via SSH after
# scp-action has uploaded fresh source to /opt/kibarometer/incoming/.
# Assumes bootstrap.sh has already brought up the Supabase fleet at least once.
set -euo pipefail

INCOMING=/opt/kibarometer/incoming
WEBSITE=/opt/kibarometer/website
ADMIN=/opt/kibarometer/admin
TAG="kiba-web:gh-$(date +%Y%m%d-%H%M%S)"

echo "== validate =="
[[ -d "$INCOMING" && -f "$INCOMING/docker/web.Dockerfile" ]] || { echo "no source"; exit 1; }
docker ps --format '{{.Names}}' | grep -q '^kiba-supabase-db$' || {
  echo "kiba-supabase-db not running — run bootstrap.sh first"; exit 1;
}

cd "$INCOMING"

echo "== stage .env.production =="
sudo cp /opt/kibarometer/env/.env.production "$INCOMING/.env.production"
sudo chown deploy:deploy "$INCOMING/.env.production"

echo "== build $TAG =="
docker build \
  --build-arg NEXT_PUBLIC_SITE_URL=https://kibarometer.no \
  -f docker/web.Dockerfile -t "$TAG" .
rm -f "$INCOMING/.env.production"

echo "== update admin sources =="
sudo cp "$INCOMING/scripts/admin-server.js" "$ADMIN/server.js"
sudo cp -r "$INCOMING/scripts/admin-sections/." "$ADMIN/sections/"
sudo chown -R deploy:deploy "$ADMIN"

echo "== update website compose =="
sudo sed -i "s|^\(\s*image:\s*\)kiba-web:[^[:space:]]*|\1$TAG|" "$WEBSITE/compose.boot.yml"
sudo cp "$INCOMING/compose.yml" "$WEBSITE/compose.yml"
sudo cp "$INCOMING/compose.prod.yml" "$WEBSITE/compose.prod.yml"
sudo cp "$INCOMING/docker/supabase/docker-compose.yml" "$WEBSITE/docker/supabase/docker-compose.yml"

echo "== apply idempotent migrations =="
# Add new filenames here as you write them. They MUST be idempotent.
for migration in 0001_baseline.sql 0002_notes.sql; do
  if [[ -f "$INCOMING/supabase/migrations/$migration" ]]; then
    echo "  applying $migration"
    docker exec -i kiba-supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
      < "$INCOMING/supabase/migrations/$migration" || echo "  WARN: $migration failed"
  fi
done

echo "== compose up =="
cd "$WEBSITE"
docker compose --env-file /opt/kibarometer/env/supabase.env \
  -f compose.yml -f docker/supabase/docker-compose.yml \
  -f compose.prod.yml -f compose.boot.yml \
  up -d --force-recreate --remove-orphans web admin

echo "== healthcheck =="
for i in $(seq 1 24); do
  if docker exec kiba-web wget -qO- http://127.0.0.1:3000/healthz >/dev/null 2>&1; then
    echo "web up after ${i}x5s"; break
  fi
  sleep 5
done

echo "== edge fragment =="
# Write our own fragment to the SHARED edge. Never modify Caddyfile,
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
smoke https://kibarometer.no/
smoke https://kibarometer.no/admin/login

echo "== cleanup old images (keep 3) =="
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
```

### 6.13 `scripts/bootstrap.sh` — one-time VPS provisioning + supabase first-up

```bash
#!/usr/bin/env bash
# scripts/bootstrap.sh — one-time provisioning on the existing Tenki VPS.
# Skips global steps (Docker, UFW, deploy user) since tenki already set them.
# Run as root via sudo. Two phases:
#   1. (default) create dirs + network. After this you populate /opt/kibarometer/env/.
#   2. (--bring-up) scp the repo to /opt/kibarometer/website/ and start the supabase fleet.
# Both phases are idempotent.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then echo "run as root"; exit 1; fi

ROOT=/opt/kibarometer
PHASE="${1:-init}"

echo "== create dirs =="
install -d -o deploy -g deploy \
  "$ROOT/website" "$ROOT/website/docker/supabase" "$ROOT/admin/sections" "$ROOT/env" \
  "$ROOT/data/postgres" "$ROOT/data/storage" \
  "$ROOT/backups" "$ROOT/build" "$ROOT/incoming"

echo "== create kiba network =="
docker network inspect kiba >/dev/null 2>&1 || docker network create kiba

if [[ "$PHASE" != "--bring-up" ]]; then
  cat <<'NOTE'

== init phase done ==

Next steps (manual):
1. Drop secrets into /opt/kibarometer/env/ (mode 600 owner deploy:deploy):
   - supabase.env  (POSTGRES_PASSWORD, JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY, …)
   - admin.env     (subset for the admin container)
   - .env.production (NEXT_PUBLIC_*)
   - backup.env    (B2 creds)
2. Copy the repo's compose files + supabase compose into /opt/kibarometer/website/:
     scp -r kibarometer/{compose.yml,compose.boot.yml,compose.prod.yml,docker/supabase/docker-compose.yml} \
       deploy@193.200.238.120:/opt/kibarometer/website/
3. Re-run this script with --bring-up to start the Supabase fleet.
4. Add GitHub secrets in the kibarometer repo:
   SSH_PRIVATE_KEY, SSH_KNOWN_HOSTS, VPS_HOST=193.200.238.120, VPS_USER=deploy
5. Push to main → first deploy refreshes web + admin.
NOTE
  exit 0
fi

# --bring-up phase
echo "== validate compose files present =="
for f in compose.yml compose.boot.yml compose.prod.yml docker/supabase/docker-compose.yml; do
  [[ -f "$ROOT/website/$f" ]] || { echo "missing $ROOT/website/$f — see step 2 above"; exit 1; }
done
[[ -f "$ROOT/env/supabase.env" ]] || { echo "missing $ROOT/env/supabase.env"; exit 1; }

echo "== bring up supabase fleet (no web/admin yet — those need a built image) =="
cd "$ROOT/website"
docker compose --env-file "$ROOT/env/supabase.env" \
  -f compose.yml -f docker/supabase/docker-compose.yml -f compose.prod.yml \
  up -d db kong auth rest storage imgproxy meta studio

echo "== wait for kong healthy =="
for i in $(seq 1 30); do
  if docker inspect kiba-supabase-kong --format '{{.State.Health.Status}}' 2>/dev/null | grep -q healthy; then
    echo "kong healthy after ${i}x2s"; break
  fi
  sleep 2
done

echo
echo "== bring-up done =="
echo "Push to main now → CI builds web + admin and the deploy.sh selective up will refresh them."
```

### 6.14 `scripts/backup.sh` — nightly B2 backup

```bash
#!/bin/sh
# scripts/backup.sh — nightly Postgres + Storage backup to Backblaze B2.
# Runs in kiba-backup-1 alpine container at 03:00 via cron.
set -eu

DATE=$(date +%Y-%m-%d)
TMP=/tmp/kiba-backup
mkdir -p "$TMP"
DUMP="$TMP/kiba-pg-$DATE.dump"
TAR="$TMP/kiba-storage-$DATE.tar.gz"

# Postgres dump
docker exec kiba-supabase-db pg_dump -U postgres -d postgres -Fc > "$DUMP"

# Storage tarball
tar czf "$TAR" -C /data storage

# Upload to B2 via rclone (configured via backup.env: RCLONE_CONFIG_*)
rclone copy "$DUMP" "b2:$B2_BUCKET/kiba/" --b2-hard-delete
rclone copy "$TAR" "b2:$B2_BUCKET/kiba/" --b2-hard-delete

# Sundays: full data snapshot
if [ "$(date +%u)" = "7" ]; then
  WEEKLY="$TMP/kiba-weekly-$DATE.tar.gz"
  tar czf "$WEEKLY" -C /opt/kibarometer data
  rclone copy "$WEEKLY" "b2:$B2_BUCKET/kiba/weekly/"
fi

# Heartbeat
[ -n "${UPTIME_KUMA_HEARTBEAT_URL:-}" ] && curl -fsS "$UPTIME_KUMA_HEARTBEAT_URL" >/dev/null || true

# Cleanup local
rm -rf "$TMP"
```

> **v2 fix:** v1 used `/data/storage/../tmp` paths that resolved to `/data/tmp` — but `/data` only has `storage/` mounted, not the parent, so `mkdir -p` would fail. Switched to `/tmp/kiba-backup` (writable inside any alpine container).

### 6.15 `scripts/generate-secrets.sh` — initial secret minting

```bash
#!/usr/bin/env bash
# scripts/generate-secrets.sh — mint Postgres password + JWT secret + derive Supabase keys.
# Outputs to /opt/kibarometer/env/supabase.env (mode 600). Run once on the VPS.
set -euo pipefail

OUT=/opt/kibarometer/env/supabase.env
[[ -f "$OUT" ]] && { echo "$OUT exists; refusing to overwrite"; exit 1; }

POSTGRES_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 64)

ANON_KEY=$(JWT_SECRET="$JWT_SECRET" node "$(dirname "$0")/mint-jwt.mjs" anon)
SERVICE_ROLE_KEY=$(JWT_SECRET="$JWT_SECRET" node "$(dirname "$0")/mint-jwt.mjs" service_role)

sudo install -d -o deploy -g deploy /opt/kibarometer/env
sudo install -m 600 -o deploy -g deploy /dev/stdin "$OUT" <<EOF
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_HOST=db
POSTGRES_PORT=5432
POSTGRES_DB=postgres
JWT_SECRET=$JWT_SECRET
SUPABASE_JWT_SECRET=$JWT_SECRET
ANON_KEY=$ANON_KEY
SUPABASE_ANON_KEY=$ANON_KEY
SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
SUPABASE_INTERNAL_URL=http://kiba-supabase-kong:8000
SUPABASE_EXTERNAL_URL=https://kibarometer.no/supabase
EOF
echo "wrote $OUT"
```

Note: `mint-jwt.mjs` (in §6.5) deterministically derives ANON_KEY and SERVICE_ROLE_KEY from JWT_SECRET — no external service calls.

### 6.16 `.github/workflows/deploy.yml`

```yaml
name: Deploy
on:
  push: { branches: [main] }
  workflow_dispatch:
concurrency:
  group: deploy
  cancel-in-progress: false
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - name: Clear incoming
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: rm -rf /opt/kibarometer/incoming/* && mkdir -p /opt/kibarometer/incoming
      - name: Upload source
        uses: appleboy/scp-action@v0.1.7
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          source: "."
          target: /opt/kibarometer/incoming/
          strip_components: 0
      - name: Run deploy.sh
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: chmod +x /opt/kibarometer/incoming/scripts/deploy.sh && bash /opt/kibarometer/incoming/scripts/deploy.sh
```

### 6.17 `.github/workflows/ci.yml`

```yaml
name: CI
on:
  pull_request:
  push:
    branches-ignore: [main]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - name: Build (with placeholder env)
        env:
          NEXT_PUBLIC_SITE_URL: https://kibarometer.no
          NEXT_PUBLIC_SUPABASE_URL: http://localhost:8000
          NEXT_PUBLIC_SUPABASE_ANON_KEY: dummy
          SUPABASE_SERVICE_ROLE_KEY: dummy
          SUPABASE_INTERNAL_URL: http://localhost:8000
        run: pnpm build
      - run: pnpm test:e2e
      - name: Gitleaks
        run: |
          curl -sL https://github.com/gitleaks/gitleaks/releases/download/v8.21.2/gitleaks_8.21.2_linux_x64.tar.gz | tar xz gitleaks
          ./gitleaks detect --source . --config .gitleaks.toml --no-banner
      - name: Validate supabase compose was forked
        # Catch regressions where someone re-lifts the upstream supabase compose
        # without re-running the rewrite step.
        run: |
          ! grep -qE '^\s*container_name:\s*supabase-' docker/supabase/docker-compose.yml
          ! grep -q '/opt/tenki/' docker/supabase/docker-compose.yml
```

### 6.18 `local-dev/setup.sh` — laptop pod (skeleton)

```bash
#!/usr/bin/env bash
# local-dev/setup.sh — bring up the full Supabase + admin pod on a laptop.
# Idempotent. SELinux-aware (uses :Z mount flags).
set -euo pipefail

DIR=$(cd "$(dirname "$0")" && pwd)
cd "$DIR"

case "${1:-up}" in
  down) docker compose -f compose.yml down; exit 0 ;;
  wipe) docker compose -f compose.yml down -v; rm -rf data/; exit 0 ;;
  up) ;;
  *) echo "usage: $0 [up|down|wipe]"; exit 1 ;;
esac

# Mint secrets if .env doesn't exist
if [[ ! -f .env ]]; then
  POSTGRES_PASSWORD=$(openssl rand -hex 24)
  JWT_SECRET=$(openssl rand -hex 64)
  ANON_KEY=$(JWT_SECRET="$JWT_SECRET" node mint-jwt.mjs anon)
  SERVICE_ROLE_KEY=$(JWT_SECRET="$JWT_SECRET" node mint-jwt.mjs service_role)
  cat > .env <<EOF
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
JWT_SECRET=$JWT_SECRET
ANON_KEY=$ANON_KEY
SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
KIBA_REPO_ROOT=$(realpath ..)
EOF
fi

# Bring up
docker compose -f compose.yml up -d

# Wait for db
for i in $(seq 1 30); do
  docker exec kiba-supabase-db pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 2
done

# Apply migrations
PGPW=$(grep -E '^POSTGRES_PASSWORD=' .env | cut -d= -f2)
for f in ../supabase/migrations/*.sql; do
  echo "applying $f"
  docker exec -i -e PGPASSWORD="$PGPW" kiba-supabase-db psql -U postgres -d postgres < "$f"
done

# Create super_admin user
node create-admin-user.mjs me@local.test localdev123 super_admin

echo
echo "Admin: http://localhost:4000/admin/login (me@local.test / localdev123)"
echo "Studio: http://localhost:8000  (basic-auth in .env)"
```

### 6.19 `CLAUDE.md` — playbook for the new repo (template in §10)

See §10 for the full template.

---

## 7. What NOT to copy from tenki-website

Explicit do-not-copy list. If you find yourself reaching for any of these, stop — they're tenki-specific.

**Labels and copy:**
- All Bokmål in `shared.js` constants (PERSON_TYPES, DEAL_STAGES, ROLE_LABEL with Norwegian text, etc.). Use English for kibarometer (or whatever target language).
- `relativeDay()`'s NO_WEEKDAYS / NO_MONTHS arrays — use English equivalents.
- Currency formatter `fmtNok` — replace with your locale's currency, or omit.

**Brand:**
- `#1A4DFF` blue — choose kibarometer's brand color.
- DM Sans + DM Mono is fine to keep (they're high-quality system-feeling typefaces) OR pick differently for kibarometer.
- Tenki SVG mark, "tenki" text in CSS / nav — replace.

**Domain:**
- All `tenki.no` references in env, code, docs, Caddyfile fragment.
- The `/blogg → /research` redirect — tenki-specific URL legacy.
- `tenki-analytics.js` — kibarometer can have its own first-party analytics later, but skip for now.

**Business-domain SQL** (entire tables — do not copy):
- `persons`, `organizations`, `deals`, `projects`, `time_entries`, `meetings`, `documents`, `services`, `research`/`blog_posts` (Tenki has these as a CRM; kibarometer has its own purpose).
- `tools`, `permissions`, `app_roles`, `role_permissions`, `profile_roles` (the permission matrix system — start with simple roles via `is_staff()` / `is_super_admin()`; add the matrix later if needed).
- `kg_*`, `vibevarsel_*`, `scrape_leads`, `business_ideas`, `competitors`, `todos` — knowledge-graph and CRM-domain tables.

**Tenki-specific env vars:**
- `KG_TOKEN_PEPPER`, `OTP_PEPPER`, `IP_HASH_SALT`, `CONTACT_NOTIFY_EMAIL`, `TENKI_MARK_SVG`, anything starting with `TENKI_*`.

**Admin sections that are CRM-domain:**
- `persons.js`, `organizations.js`, `deals.js`, `projects.js`, `meetings.js`, `time.js`, `documents.js`, `blog.js`, `knowledge-graph.js`, `kg-*`, `vibevarsel.js`, `scrapers.js`, `ideas.js`, `competitors.js`, `todos.js`.

**Compose lifts (REPEATED for emphasis — see §0 / §6.0):**
- Never lift `docker/supabase/docker-compose.yml` from tenki without running `scripts/fork-supabase-compose.sh`. The unrewritten file collides on container names AND mounts tenki's actual data dirs. Both bugs are silent until first `up -d`.

**Misc:**
- `scripts/seo-patch.sh` — patches a static mirror that no longer exists in tenki post-phase-6.

---

## 8. Shared-edge integration spec

The Tenki edge at `/opt/edge/` is shared infrastructure. To coexist with tenki without breaking it:

### What you write
- **Only** `/opt/edge/sites/kibarometer.caddy` — your own routing fragment. The `sites/` dir is deploy-writable.

### What you read but never modify
- `/opt/edge/Caddyfile` (umbrella — owned by the edge bootstrapper, currently tenki)
- `/opt/edge/compose.yml` (edge stack definition)
- `/opt/edge/sites/tenki.caddy` (tenki's own fragment — never touch)
- `/opt/edge/data/` (Caddy state, including ACME account key + issued certs — root-owned, not deploy-accessible. **Don't try to read or write this**.)

### What you run as part of every deploy
```bash
sudo cp docker/edge/sites/kibarometer.caddy /opt/edge/sites/kibarometer.caddy
docker network connect kiba edge-caddy-1 2>/dev/null || true   # idempotent
docker exec edge-caddy-1 caddy reload --config /etc/caddy/Caddyfile
```

### What you must not do
- Do not run `docker compose down` in `/opt/edge/` — that would kill tenki's edge too.
- Do not modify Caddy globals (`email`, `security_headers` snippet) — those are in the umbrella.
- Do not chown `/opt/edge/data/` or change anything inside it. Caddy runs in the container as uid 0 with `CAP_DAC_OVERRIDE` dropped (security hardening) — files there are root-owned to match the in-container UID. Touching this can crash-loop the edge. (See `scripts/deploy.sh` in tenki for the chown-to-root-not-deploy pattern; we don't replicate it because we don't manage `/opt/edge/data/`.)
- Do not name a container with a `tenki-` or `supabase-` prefix (use `kiba-` and `kiba-supabase-`).
- Do not reuse tenki's Postgres credentials, JWT secret, or any secret from `/opt/tenki/env/`.
- Do not name your network `tenki` or `edge_net` (those exist; you join `edge_net` as external and create `kiba` for your own).

### Cert email
The shared `/opt/edge/Caddyfile` hardcodes `email einar@tenki.no` for the global ACME account. ACME notifications for `kibarometer.no` certs will go to that address by default. Two options:

1. **Accept it** (single team, both sites — simplest, what tenki does for itself).
2. **Pin a per-site contact** by adding a `tls <email>` directive inside the `kibarometer.no { … }` block in `kibarometer.caddy`. This overrides the global email for kibarometer's certs only. Don't change the umbrella's global email — that's tenki's.

### Trust boundary acknowledgment
Both tenki's deploy and your deploy run as the same `deploy@193.200.238.120` user with sudo. Convention says you only write your own fragment. **Nothing enforces this** — a buggy or compromised deploy could overwrite tenki's fragment and reroute traffic. Acceptable today because it's a single trust domain (one team, both repos). If a third party is ever onboarded, the model needs tightening (per-site Linux user + restricted sudoers).

---

## 9. Verification

After Phase 10 (DNS go-live):

```bash
# Both sites resolve to the same VPS
dig kibarometer.no    # → 193.200.238.120
dig tenki.no          # → 193.200.238.120

# Both sites serve HTTPS with their own certs
curl -sI https://kibarometer.no/                # 200, valid LE cert
curl -sI https://kibarometer.no/admin/login     # 200
curl -sI https://tenki.no/                      # 200, untouched

# Network isolation
ssh deploy@193.200.238.120
docker exec kiba-admin nslookup tenki-supabase-db   # should NOT resolve
docker exec tenki-admin nslookup kiba-supabase-db   # should NOT resolve
docker exec edge-caddy-1 nslookup kiba-web          # SHOULD resolve
docker exec edge-caddy-1 nslookup tenki-web         # SHOULD resolve

# Container names are properly forked
docker ps --format '{{.Names}}' | grep '^supabase-' && echo 'BAD: unforked supabase-* containers found' || echo 'OK'
docker ps --format '{{.Names}}' | grep '^kiba-supabase-' | wc -l   # should be 8

# Bind mounts point to /opt/kibarometer/, not /opt/tenki/
docker inspect kiba-supabase-db --format '{{range .Mounts}}{{.Source}} → {{.Destination}}{{println}}{{end}}' | grep /opt/
# expected: /opt/kibarometer/data/postgres → /var/lib/postgresql/data

# Edge fragments
ls /opt/edge/sites/        # tenki.caddy + kibarometer.caddy

# Independent deploys
git -C /opt/tenki/website log -1     # last tenki deploy
git -C /opt/kibarometer/website log -1   # last kibarometer deploy

# Backups landed in B2
rclone ls b2:$B2_BUCKET/kiba/ | head
```

If any of those fail, see §10's troubleshooting (in the new repo's CLAUDE.md).

---

## 10. CLAUDE.md template for the new repo

Drop this into `kibarometer/CLAUDE.md` after Phase 8. Replace `<…>` placeholders with project-specific values.

````markdown
# CLAUDE.md — kibarometer playbook

You are working in **`<your-org>/kibarometer`**, the repo for kibarometer.no.
Read this top-to-bottom on a cold start.

## 1. Mission

<one paragraph describing what kibarometer does>

## 2. Current state

**Lives on:** Gigahost VPS `193.200.238.120` (shared with tenki.no).
**Domain:** kibarometer.no resolves to `193.200.238.120`.
**Stack on VPS:**
- `kiba-web` — Next.js standalone (built from `docker/web.Dockerfile`)
- `kiba-admin` — Node 22, zero npm deps
- `kiba-supabase-{db,kong,auth,rest,storage,imgproxy,meta,studio}` (forked from tenki via `scripts/fork-supabase-compose.sh`)
- `kiba-redis`, `kiba-backup-1`
- Shared: `edge-caddy-1` at `/opt/edge/` (read-only from our side except for `/opt/edge/sites/kibarometer.caddy`)

## 3. Architecture

- **Edge:** Caddy at `/opt/edge/` (shared with tenki). Our routing fragment lives at `/opt/edge/sites/kibarometer.caddy` (synced from `docker/edge/sites/kibarometer.caddy` on every deploy). We never touch `/opt/edge/Caddyfile`, `/opt/edge/compose.yml`, or `/opt/edge/data/`.
- **Admin Node:** zero-deps `scripts/admin-server.js` + `scripts/admin-sections/*.js`. Server-rendered HTML via `html\`...\``. JWT verified locally (HS256, no SDK round-trip).
- **Marketing Next.js:** `app/` (server components by default), `lib/env.ts` (zod-validated env).
- **Networks:** containers join `kiba`. Caddy joins `edge_net + kiba` (post-up via `docker network connect`).
- **Supabase compose:** committed to repo at `docker/supabase/docker-compose.yml`. ALREADY rewritten by `scripts/fork-supabase-compose.sh` (container names + bind paths). Never re-lift the upstream without re-running the rewrite — CI guards against it.

## 4. Code conventions

- **Zero npm deps in admin.** Node 22 builtins only.
- **ES modules.** Imports use `.js` extension.
- **Server-rendered HTML.** `html\`…\`` auto-escapes; `rawHtml\`…\`` doesn't. Never concatenate user input into HTML.
- **PRG on every form.** POSTs redirect on success; never return HTML from a POST.
- **`sbFetch(path, { token, service, method, body, prefer })`** is the only PostgREST client. No `@supabase/supabase-js` in admin.
- **`btn()` for every CTA** — see `scripts/admin-sections/shared.js`.
- **Conventional Commits.** Sign Claude-authored commits with `Co-Authored-By: Claude <noreply@anthropic.com>`.

## 5. How to add a section

1. Migration: `supabase/migrations/00NN_<name>.sql` (idempotent; `create table if not exists`, RLS, policies).
2. Add filename to the migration loop in `scripts/deploy.sh`.
3. Section file: `scripts/admin-sections/<name>.js` exporting `listInner`, `detailInner`, `create`, `update`, `delete`.
4. Import in `scripts/admin-server.js` and add routes.
5. Add nav entry to the `NAV` constant.
6. Test locally (`./local-dev/setup.sh`), commit, push.

## 6. Migrations

Idempotent only — they re-run on every deploy. For destructive migrations, apply manually via psql once, then merge dependent code.

```bash
ssh deploy@193.200.238.120
docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" kiba-supabase-db \
  psql -U postgres -d postgres < /opt/kibarometer/website/supabase/migrations/00NN_foo.sql
```

## 7. Deploy

`git push origin main` → GH Actions → `scripts/deploy.sh` on the VPS. Builds image, syncs admin, applies migrations, recreates web+admin (NOT the supabase fleet — that came up via `bootstrap.sh --bring-up`), syncs edge fragment, reloads Caddy, smoke-tests.

If the supabase fleet ever needs to come back up after `down`, re-run `sudo bash scripts/bootstrap.sh --bring-up` on the VPS.

## 8. Local-dev

```bash
./local-dev/setup.sh         # up
./local-dev/setup.sh down    # stop, keep data
./local-dev/setup.sh wipe    # reset
```

Admin at http://localhost:4000/admin/login (me@local.test / localdev123).

## 9. Secrets

VPS only, mode 600 deploy:deploy:
```
/opt/kibarometer/env/supabase.env
/opt/kibarometer/env/admin.env
/opt/kibarometer/env/.env.production
/opt/kibarometer/env/backup.env
```

## 10. Forward motion

When direction is approved, make sensible defaults and announce them. Don't serialize sub-confirmations. Course-correct in commit messages.

## 11. Out of scope

- Don't push to `main` without PR.
- Don't `--no-verify` or force-push.
- Don't add npm deps to the admin.
- Don't modify `/opt/edge/Caddyfile`, `/opt/edge/compose.yml`, or `/opt/edge/data/` — those belong to the edge owner (tenki).
- Don't reuse tenki's secrets, paths, container names, or networks.
- Don't lift `docker/supabase/docker-compose.yml` from tenki without re-running `scripts/fork-supabase-compose.sh` (CI catches this).
````

---

## End

Build top-to-bottom. Skip nothing in §1 (constraints) or §0 (changelog vs v1). Adapt freely in §6 (templates). Question anything in §3 if it doesn't fit your actual product.
