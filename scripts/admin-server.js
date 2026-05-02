// scripts/admin-server.js
// kibarometer admin — auth via self-hosted Supabase, sidebar UI, sections via PostgREST.
// Zero npm deps (Node 22 builtins only).
import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { URL } from "node:url";
import { btn, esc, parseFlash, flashQs } from "./sections/shared.js";
import * as Jobs from "./sections/jobs.js";
import * as Keywords from "./sections/keywords.js";

const PORT = Number(process.env.PORT || 4000);
const SUPABASE_URL = process.env.SUPABASE_INTERNAL_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
const FETCHER_TOKEN = process.env.FETCHER_TOKEN;
const NODE_ENV = process.env.NODE_ENV || "development";

for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET, FETCHER_TOKEN })) {
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

// Staff role check — looks at user_metadata.role baked into the JWT by GoTrue.
// Defense in depth on top of GoTrue's DISABLE_SIGNUP=true (no random signups).
const STAFF_ROLES = new Set(["super_admin", "admin", "employee", "read_only"]);
function isStaff(claims) {
  return STAFF_ROLES.has(claims?.user_metadata?.role);
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

// ---------- PostgREST client (kept here so sections can import it from server) ----------
export async function sbFetch(path, { token, service = false, method = "GET", body, headers = {}, prefer } = {}) {
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

// ---------- SPA-nav (intercepts sidebar links + form POSTs) ----------
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
.sidebar { background: var(--surface); border-right: 1px solid var(--subtle); padding: 1.25rem 1rem; display: flex; flex-direction: column; }
.sidebar nav a { display: block; padding: .4rem .6rem; color: var(--ink); text-decoration: none; font: 500 .72rem/1 "DM Mono", monospace; text-transform: uppercase; letter-spacing: .18em; }
.sidebar nav a[aria-current=page] { box-shadow: inset 2px 0 0 var(--accent); }
.sidebar form { margin-top: auto; }
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
input, select, textarea { padding: .55rem .8rem; border: 1px solid var(--subtle); background: white; font: inherit; width: 100%; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: .65rem .85rem; text-align: left; border-bottom: 1px solid var(--subtle); }
th { font: 500 .68rem/1 "DM Mono", monospace; text-transform: uppercase; letter-spacing: .18em; color: var(--muted); }
`;

// Sidebar nav.
const NAV = [
  ["/admin", "Oversikt"],
  ["/admin/jobs", "Jobber"],
  ["/admin/keywords", "Nøkkelord"],
];

async function layout(path, claims, inner, flash) {
  const navHtml = NAV.map(([href, label]) => {
    const active = path === href || path.startsWith(href + "/");
    return `<a href="${href}" data-admin-link="true"${active ? ' aria-current="page"' : ""}>${label}</a>`;
  }).join("");
  const flashHtml = flash
    ? (flash.ok ? `<div class="ok">${esc(flash.ok)}</div>` : "") + (flash.error ? `<div class="err">${esc(flash.error)}</div>` : "")
    : "";
  const who = esc(claims?.email || "");
  return `<!doctype html><html lang="nb"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>kibarometer admin</title>
    <style>${CSS}</style>
  </head><body data-first-load="true">
    <div class="layout">
      <aside class="sidebar">
        <div class="eyebrow" style="margin-bottom:1rem">kibarometer</div>
        <nav>${navHtml}</nav>
        <form method="post" action="/admin/logout">
          <div class="eyebrow" style="margin-bottom:.4rem">${who}</div>
          ${btn({ label: "Logg ut", variant: "ghost", size: "small" })}
        </form>
      </aside>
      <main>${flashHtml}${inner}</main>
    </div>
    ${SPA_NAV_SCRIPT}
  </body></html>`;
}

// ---------- Pages ----------
function loginPage({ error } = {}) {
  return `<!doctype html><html lang="nb"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Logg inn — kibarometer admin</title>
    <style>${CSS}</style>
  </head>
    <body><main style="max-width:420px;margin:8vh auto">
      <div class="eyebrow" style="margin-bottom:.4rem">kibarometer</div>
      <h1 class="title" style="margin-bottom:1rem">Logg inn</h1>
      ${error ? `<div class="err">${esc(error)}</div>` : ""}
      <form method="post" action="/admin/login">
        <label style="display:block">E-post<input type="email" name="email" required autofocus></label>
        <label style="display:block;margin-top:.85rem">Passord<input type="password" name="password" required></label>
        <div style="margin-top:1.2rem">${btn({ label: "Logg inn" })}</div>
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

function dashboardInner(claims) {
  const role = esc(claims?.user_metadata?.role || "ukjent");
  const name = esc(claims?.user_metadata?.full_name || claims?.email || "ukjent");
  return `<div class="titlewrap" style="margin-bottom:1.5rem">
      <span class="eyebrow">· admin</span>
      <h1 class="title" style="margin:.4rem 0 0">Oversikt</h1>
    </div>
    <div class="card">
      <p style="margin:0">Velkommen, <strong>${name}</strong>. Rolle: <code>${role}</code>.</p>
      <p style="margin-top:.75rem;color:var(--muted)">NAV-fetcher, jobblogg og publiserte snapshots kommer i Fase 4 og senere.</p>
    </div>`;
}

const COOKIE = (val) =>
  `sb_access_token=${val}; Path=/; HttpOnly; SameSite=Lax${NODE_ENV === "production" ? "; Secure" : ""}`;

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
  const redirect = (loc, extraHeaders = {}) => {
    res.writeHead(302, { Location: loc, ...extraHeaders });
    res.end();
  };

  try {
    if (path === "/admin/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true }));
    }

    // Bearer-authed cron endpoints. No cookie auth, no PRG — return JSON.
    // Caddy routes /admin/* to this server, so these paths are reachable
    // externally; FETCHER_TOKEN is the only thing protecting them.
    const BEARER_HANDLERS = {
      "/admin/api/jobs/fetch-nav":         Jobs.fetchNav,
      "/admin/api/jobs/backfill-nav":      Jobs.backfillNav,
      "/admin/api/jobs/enrich-nav":        Jobs.enrichNav,
      "/admin/api/jobs/reprocess":         Jobs.reprocessNavPostings,
      "/admin/api/jobs/refresh-snapshots": Jobs.refreshSnapshots,
    };
    if (BEARER_HANDLERS[path] && req.method === "POST") {
      const auth = req.headers.authorization || "";
      const presented = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      const a = Buffer.from(presented), b = Buffer.from(FETCHER_TOKEN);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "unauthorized" }));
      }
      const result = await BEARER_HANDLERS[path]({ sb: sbFetch, trigger: "cron" });
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(result));
    }

    if (path === "/admin/login" && req.method === "GET") return send(200, loginPage());
    if (path === "/admin/login" && req.method === "POST") {
      const body = await readBody(req);
      const t = await loginSubmit(body.email, body.password);
      if (!t) return send(401, loginPage({ error: "Ugyldig e-post eller passord" }));
      const c = verifySupabaseJwt(t);
      if (!isStaff(c)) return send(403, loginPage({ error: "Kontoen har ikke tilgang til admin" }));
      return redirect("/admin", { "Set-Cookie": COOKIE(t) });
    }
    if (path === "/admin/logout" && req.method === "POST") {
      return redirect("/admin/login", { "Set-Cookie": "sb_access_token=; Path=/; HttpOnly; Max-Age=0" });
    }

    // Auth gate for everything below.
    if (path.startsWith("/admin") && (!claims || !isStaff(claims))) return redirect("/admin/login");

    if (path === "/admin" || path === "/admin/") return sendPage(dashboardInner(claims));

    if (path === "/admin/jobs" && req.method === "GET")
      return sendPage(await Jobs.listInner({ sb: sbFetch }));
    if (path === "/admin/jobs/fetch" && req.method === "POST") {
      try {
        const result = await Jobs.fetchNav({ sb: sbFetch, trigger: "manual" });
        return redirect(`/admin/jobs${flashQs({ ok: `Hentet ${result.rows_processed} stillinger` })}`);
      } catch (err) {
        return redirect(`/admin/jobs${flashQs({ error: `Henting feilet: ${err.message}` })}`);
      }
    }
    if (path === "/admin/jobs/backfill" && req.method === "POST") {
      try {
        const result = await Jobs.backfillNav({ sb: sbFetch, trigger: "manual" });
        const msg = result.status === "noop"
          ? "Backfill er allerede ferdig."
          : `Backfill-batch: ${result.pages} sider, ${result.items} stillinger${result.completed ? " — ferdig!" : ""}`;
        return redirect(`/admin/jobs${flashQs({ ok: msg })}`);
      } catch (err) {
        return redirect(`/admin/jobs${flashQs({ error: `Backfill feilet: ${err.message}` })}`);
      }
    }
    if (path === "/admin/jobs/enrich" && req.method === "POST") {
      try {
        const result = await Jobs.enrichNav({ sb: sbFetch, trigger: "manual" });
        const msg = result.status === "noop"
          ? "Ingen ACTIVE stillinger å berike."
          : `Beriket ${result.enriched}, hoppet over ${result.inactive} (INACTIVE), feilet ${result.failed} av ${result.candidates} kandidater.`;
        return redirect(`/admin/jobs${flashQs({ ok: msg })}`);
      } catch (err) {
        return redirect(`/admin/jobs${flashQs({ error: `Berikelse feilet: ${err.message}` })}`);
      }
    }
    if (path === "/admin/jobs/reprocess" && req.method === "POST") {
      try {
        const result = await Jobs.reprocessNavPostings({ sb: sbFetch, trigger: "manual" });
        return redirect(`/admin/keywords${flashQs({ ok: `Re-tagget ${result.updated} av ${result.scanned} stillinger.` })}`);
      } catch (err) {
        return redirect(`/admin/keywords${flashQs({ error: `Re-tagging feilet: ${err.message}` })}`);
      }
    }
    if (path === "/admin/jobs/refresh-snapshots" && req.method === "POST") {
      try {
        const result = await Jobs.refreshSnapshots({ sb: sbFetch, trigger: "manual" });
        const hl = result.headline;
        const msg = hl
          ? `Snapshots oppdatert. AI-stillinger 7d: ${hl.ai_count_7d}, 30d: ${hl.ai_count_30d}.`
          : "Snapshots oppdatert.";
        return redirect(`/admin/jobs${flashQs({ ok: msg })}`);
      } catch (err) {
        return redirect(`/admin/jobs${flashQs({ error: `Snapshot-refresh feilet: ${err.message}` })}`);
      }
    }

    // Keywords section
    if (path === "/admin/keywords" && req.method === "GET")
      return sendPage(await Keywords.listInner({ sb: sbFetch }));
    if (path === "/admin/keywords/create" && req.method === "POST") {
      const body = await readBody(req);
      try {
        const row = await Keywords.create({ sb: sbFetch, body });
        return redirect(`/admin/keywords${flashQs({ ok: `La til "${row.term}"` })}`);
      } catch (err) {
        return redirect(`/admin/keywords${flashQs({ error: err.message })}`);
      }
    }
    const kwMatch = path.match(/^\/admin\/keywords\/([0-9a-f-]{36})(?:\/(update|toggle))?$/);
    if (kwMatch) {
      const [, id, action] = kwMatch;
      if (!action && req.method === "GET")
        return sendPage(await Keywords.detailInner({ sb: sbFetch, id }));
      if (action === "update" && req.method === "POST") {
        const body = await readBody(req);
        try {
          await Keywords.update({ sb: sbFetch, id, body });
          return redirect(`/admin/keywords${flashQs({ ok: "Lagret" })}`);
        } catch (err) {
          return redirect(`/admin/keywords/${id}${flashQs({ error: err.message })}`);
        }
      }
      if (action === "toggle" && req.method === "POST") {
        try {
          const row = await Keywords.toggle({ sb: sbFetch, id });
          return redirect(`/admin/keywords${flashQs({ ok: row.is_active ? "Aktivert" : "Deaktivert" })}`);
        } catch (err) {
          return redirect(`/admin/keywords${flashQs({ error: err.message })}`);
        }
      }
    }

    return send(404, `<h1>404</h1><p>Fant ikke ${esc(path)}</p>`);
  } catch (err) {
    console.error(err);
    return send(500, `<h1>Feil</h1><pre>${esc(err.message)}</pre>`);
  }
});

server.listen(PORT, () => console.log(`admin listening on :${PORT}`));
