// scripts/admin-sections/jobs.js
// Admin section: list job runs + manual fetch trigger.
// fetchNav() is shared by:
//   POST /admin/jobs/fetch          (cookie-authed button on this page)
//   POST /admin/api/jobs/fetch-nav  (bearer-authed cron entry point)
import { esc, rawHtml, fmtDateTime, btn, pageHead } from "./shared.js";
import { fetchStillingsfeed } from "../nav/client.js";

const STATUS_LABEL = { running: "Kjører", success: "OK", failed: "Feilet" };
const TRIGGER_LABEL = { manual: "manuell", cron: "cron" };

function statusBadge(s) {
  const colour = s === "success" ? "#0F8F3C" : s === "failed" ? "#B83A2A" : "#6E6E76";
  return `<span style="display:inline-block;padding:.15rem .55rem;background:${colour};color:white;font:500 .65rem/1 'DM Mono',monospace;text-transform:uppercase;letter-spacing:.14em">${esc(STATUS_LABEL[s] || s)}</span>`;
}

function durationLabel(started, finished) {
  if (!finished) return "—";
  const ms = new Date(finished) - new Date(started);
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 1000)} s`;
}

export async function listInner({ sb }) {
  const rows = await sb(
    `/jobs?select=id,name,trigger,status,started_at,finished_at,rows_processed,error&order=started_at.desc&limit=50`,
    { service: true }
  );
  const tbody = rows.length === 0
    ? `<tr><td colspan="6" class="empty">Ingen jobber ennå.</td></tr>`
    : rows.map(r => `<tr>
        <td><code>${esc(r.name)}</code></td>
        <td>${statusBadge(r.status)}</td>
        <td>${esc(fmtDateTime(r.started_at))}</td>
        <td>${esc(durationLabel(r.started_at, r.finished_at))}</td>
        <td>${r.rows_processed ?? "—"}</td>
        <td>${esc(TRIGGER_LABEL[r.trigger] || r.trigger)}${r.error ? `<div style="color:#B83A2A;font-size:.78rem;margin-top:.15rem">${esc(r.error.slice(0, 200))}</div>` : ""}</td>
      </tr>`).join("");
  return rawHtml`
    ${pageHead("admin", "Jobber")}
    <div class="card" style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap">
      <div style="flex:1;min-width:200px">
        <div class="eyebrow" style="margin-bottom:.3rem">NAV Stillingsfeed</div>
        <div style="color:var(--muted);font-size:.92rem">Henter siste side fra <code>pam-stilling-feed.nav.no/api/v1/feed</code> og lagrer rå-payload i <code>nav_raw</code>.</div>
      </div>
      <form method="post" action="/admin/jobs/fetch">
        ${btn({ label: "Hent NAV nå" })}
      </form>
    </div>
    <div class="card" style="margin-top:1.25rem">
      <table>
        <thead><tr>
          <th>Jobb</th><th>Status</th><th>Startet</th><th>Varighet</th><th>Rader</th><th>Trigger</th>
        </tr></thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>
  `;
}

// Run a NAV fetch end-to-end. Idempotent in the "data" sense (each run inserts
// a new nav_raw + jobs row) but never mutates earlier rows.
export async function fetchNav({ sb, trigger = "manual" }) {
  const [job] = await sb(`/jobs`, {
    service: true,
    method: "POST",
    body: { name: "fetch_nav_stillingsfeed", trigger },
    prefer: "return=representation",
  });

  try {
    const result = await fetchStillingsfeed();
    const ok = result.http_status >= 200 && result.http_status < 300;
    if (!ok) throw new Error(`NAV feed returned HTTP ${result.http_status}`);

    await sb(`/nav_raw`, {
      service: true,
      method: "POST",
      body: {
        endpoint: result.endpoint,
        params: result.params,
        payload: result.payload,
        http_status: result.http_status,
        duration_ms: result.duration_ms,
      },
    });

    const items = Array.isArray(result.payload?.items) ? result.payload.items : [];
    await sb(`/jobs?id=eq.${job.id}`, {
      service: true,
      method: "PATCH",
      body: {
        finished_at: new Date().toISOString(),
        status: "success",
        rows_processed: items.length,
      },
    });

    return { id: job.id, status: "success", rows_processed: items.length, http_status: result.http_status };
  } catch (err) {
    await sb(`/jobs?id=eq.${job.id}`, {
      service: true,
      method: "PATCH",
      body: {
        finished_at: new Date().toISOString(),
        status: "failed",
        error: String(err.message || err).slice(0, 1000),
      },
    });
    throw err;
  }
}
