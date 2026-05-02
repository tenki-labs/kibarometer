// scripts/admin-sections/keywords.js
// Admin section: keyword inclusion list (the methodology core).
// Soft-delete only — flipping is_active=false preserves any matched_keywords[]
// arrays that future nav_postings rows will hold.
import { esc, rawHtml, fmtDateTime, btn, pageHead, nullIfEmpty } from "./shared.js";

const LANGUAGES = ["any", "no", "en"];
const CATEGORIES = ["tool", "role", "concept"];
const MATCH_TYPES = ["word", "substring"];

const CATEGORY_LABEL = { tool: "Verktøy", role: "Rolle / tittel", concept: "Begrep" };
const LANGUAGE_LABEL = { any: "alle", no: "norsk", en: "engelsk" };
const MATCH_LABEL = { word: "ord", substring: "delstreng" };

const SELECT_COLS =
  "id,term,language,category,match_type,is_active,notes,created_at,updated_at";

function badge(text, colour = "#6E6E76") {
  return `<span style="display:inline-block;padding:.12rem .5rem;background:${colour};color:white;font:500 .62rem/1 'DM Mono',monospace;text-transform:uppercase;letter-spacing:.14em">${esc(text)}</span>`;
}

function langBadge(l) {
  const c = l === "any" ? "#1A4DFF" : l === "no" ? "#0F8F3C" : "#B83A2A";
  return badge(LANGUAGE_LABEL[l] || l, c);
}

function matchBadge(m) {
  return badge(MATCH_LABEL[m] || m, "#0F0F12");
}

function categorySection(cat, rows) {
  const tbody = rows.length === 0
    ? `<tr><td colspan="6" class="empty">Ingen i denne kategorien.</td></tr>`
    : rows.map((r) => {
        const dim = r.is_active ? "" : "opacity:.45";
        return `<tr style="${dim}">
          <td><strong>${esc(r.term)}</strong>${r.notes ? `<div style="font-size:.78rem;color:var(--muted);margin-top:.15rem">${esc(r.notes)}</div>` : ""}</td>
          <td>${langBadge(r.language)}</td>
          <td>${matchBadge(r.match_type)}</td>
          <td>${r.is_active ? "✓" : "—"}</td>
          <td style="font-size:.78rem;color:var(--muted)">${esc(fmtDateTime(r.updated_at))}</td>
          <td style="white-space:nowrap;text-align:right">
            ${btn({ label: "Endre", variant: "ghost", size: "small", href: `/admin/keywords/${r.id}` })}
            <form method="post" action="/admin/keywords/${r.id}/toggle" style="display:inline;margin-left:.3rem">
              ${btn({ label: r.is_active ? "Skjul" : "Aktiver", variant: "ghost", size: "small" })}
            </form>
          </td>
        </tr>`;
      }).join("");
  return `<div class="card" style="margin-top:1.25rem">
    <div class="eyebrow" style="margin-bottom:.6rem">${esc(CATEGORY_LABEL[cat] || cat)} <span style="color:var(--muted);text-transform:none;letter-spacing:0;font-family:inherit">· ${rows.filter(r => r.is_active).length} aktive / ${rows.length} totalt</span></div>
    <table>
      <thead><tr>
        <th>Term</th><th>Språk</th><th>Match</th><th>Aktiv</th><th>Endret</th><th></th>
      </tr></thead>
      <tbody>${tbody}</tbody>
    </table>
  </div>`;
}

function newForm() {
  const langOptions = LANGUAGES.map(l => `<option value="${l}">${esc(LANGUAGE_LABEL[l])}</option>`).join("");
  const catOptions = CATEGORIES.map(c => `<option value="${c}">${esc(CATEGORY_LABEL[c])}</option>`).join("");
  const matchOptions = MATCH_TYPES.map(m => `<option value="${m}">${esc(MATCH_LABEL[m])}</option>`).join("");
  return `<form method="post" action="/admin/keywords/create" class="card" style="margin-top:1rem">
    <div class="eyebrow" style="margin-bottom:.6rem">Nytt nøkkelord</div>
    <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr auto;gap:.6rem;align-items:end">
      <label>Term<input type="text" name="term" required placeholder="f.eks. PyTorch"></label>
      <label>Språk<select name="language">${langOptions}</select></label>
      <label>Kategori<select name="category">${catOptions}</select></label>
      <label>Match<select name="match_type">${matchOptions}</select></label>
      ${btn({ label: "Legg til" })}
    </div>
    <label style="display:block;margin-top:.6rem">Notat (valgfritt)<input type="text" name="notes" placeholder="kontekst, FP-risiko, osv."></label>
  </form>`;
}

export async function listInner({ sb }) {
  const rows = await sb(
    `/keywords?select=${SELECT_COLS}&order=category.asc,term_norm.asc`,
    { service: true }
  );
  const byCat = { tool: [], role: [], concept: [] };
  for (const r of rows) (byCat[r.category] || (byCat[r.category] = [])).push(r);
  const sections = CATEGORIES.map((c) => categorySection(c, byCat[c] || [])).join("");
  return rawHtml`
    ${pageHead("admin", "Nøkkelord")}
    <div class="card" style="display:flex;align-items:flex-start;gap:1rem;flex-wrap:wrap">
      <div style="flex:1;min-width:240px;color:var(--muted);font-size:.92rem">
        Inkluderingslisten avgjør hva som teller som AI-relatert. Endringer her
        slår igjennom på neste re-tagging av <code>nav_postings</code>.
        Public read er begrenset til aktive rader, så metode-siden viser bare
        det som faktisk brukes.
      </div>
      <form method="post" action="/admin/jobs/reprocess">
        ${btn({
          label: "Re-tag alle stillinger",
          variant: "ghost",
          confirm: "Re-tag alle nav_postings mot dagens nøkkelordliste? Kan ta noen minutter.",
        })}
      </form>
    </div>
    ${newForm()}
    ${sections}
  `;
}

export async function detailInner({ sb, id }) {
  const [row] = await sb(
    `/keywords?id=eq.${encodeURIComponent(id)}&select=${SELECT_COLS}`,
    { service: true }
  );
  if (!row) {
    return rawHtml`
      ${pageHead("admin", "Nøkkelord")}
      <div class="card"><div class="empty">Ikke funnet.</div></div>
      <div style="margin-top:1rem">${btn({ label: "Tilbake", variant: "ghost", href: "/admin/keywords" })}</div>
    `;
  }
  const langOptions = LANGUAGES.map(l =>
    `<option value="${l}"${l === row.language ? " selected" : ""}>${esc(LANGUAGE_LABEL[l])}</option>`).join("");
  const catOptions = CATEGORIES.map(c =>
    `<option value="${c}"${c === row.category ? " selected" : ""}>${esc(CATEGORY_LABEL[c])}</option>`).join("");
  const matchOptions = MATCH_TYPES.map(m =>
    `<option value="${m}"${m === row.match_type ? " selected" : ""}>${esc(MATCH_LABEL[m])}</option>`).join("");
  return rawHtml`
    ${pageHead("admin", "Endre nøkkelord")}
    <form method="post" action="/admin/keywords/${esc(row.id)}/update" class="card">
      <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:.75rem">
        <label>Term<input type="text" name="term" required value="${esc(row.term)}"></label>
        <label>Språk<select name="language">${langOptions}</select></label>
        <label>Kategori<select name="category">${catOptions}</select></label>
        <label>Match<select name="match_type">${matchOptions}</select></label>
      </div>
      <label style="display:block;margin-top:.75rem">Notat<textarea name="notes" rows="3" style="resize:vertical">${esc(row.notes || "")}</textarea></label>
      <label style="display:block;margin-top:.75rem">
        <input type="checkbox" name="is_active" value="1"${row.is_active ? " checked" : ""} style="width:auto;margin-right:.4rem">
        Aktiv (vises på metode-siden, brukes ved tagging)
      </label>
      <div style="margin-top:1rem;display:flex;gap:.6rem">
        ${btn({ label: "Lagre" })}
        ${btn({ label: "Avbryt", variant: "ghost", href: "/admin/keywords" })}
      </div>
    </form>
    <div class="card" style="margin-top:1rem;font-size:.78rem;color:var(--muted)">
      Opprettet ${esc(fmtDateTime(row.created_at))} · sist endret ${esc(fmtDateTime(row.updated_at))} · id <code>${esc(row.id)}</code>
    </div>
  `;
}

function validatePayload(body, { partial = false } = {}) {
  const out = {};
  if (!partial || body.term !== undefined) {
    const term = nullIfEmpty(body.term);
    if (!term) throw new Error("Term mangler");
    if (term.length > 200) throw new Error("Term er for lang (maks 200 tegn)");
    out.term = term;
  }
  if (!partial || body.language !== undefined) {
    if (!LANGUAGES.includes(body.language)) throw new Error("Ukjent språk");
    out.language = body.language;
  }
  if (!partial || body.category !== undefined) {
    if (!CATEGORIES.includes(body.category)) throw new Error("Ukjent kategori");
    out.category = body.category;
  }
  if (!partial || body.match_type !== undefined) {
    const mt = body.match_type || "word";
    if (!MATCH_TYPES.includes(mt)) throw new Error("Ukjent match-type");
    out.match_type = mt;
  }
  if (body.notes !== undefined) {
    out.notes = nullIfEmpty(body.notes);
  }
  return out;
}

export async function create({ sb, body }) {
  const payload = validatePayload(body);
  try {
    const [row] = await sb(`/keywords`, {
      service: true,
      method: "POST",
      body: payload,
      prefer: "return=representation",
    });
    return row;
  } catch (err) {
    // PostgREST 409 on the (term_norm, language) unique constraint.
    if (/duplicate key|already exists|23505/.test(err.message)) {
      throw new Error(`"${payload.term}" finnes allerede for ${LANGUAGE_LABEL[payload.language]}`);
    }
    throw err;
  }
}

export async function update({ sb, id, body }) {
  const payload = validatePayload(body);
  // Checkbox is absent from form-encoded body when unchecked, so we infer.
  payload.is_active = body.is_active === "1" || body.is_active === "on" || body.is_active === true;
  const [row] = await sb(`/keywords?id=eq.${encodeURIComponent(id)}`, {
    service: true,
    method: "PATCH",
    body: payload,
    prefer: "return=representation",
  });
  if (!row) throw new Error("Ikke funnet");
  return row;
}

export async function toggle({ sb, id }) {
  const [current] = await sb(`/keywords?id=eq.${encodeURIComponent(id)}&select=is_active`, { service: true });
  if (!current) throw new Error("Ikke funnet");
  const [row] = await sb(`/keywords?id=eq.${encodeURIComponent(id)}`, {
    service: true,
    method: "PATCH",
    body: { is_active: !current.is_active },
    prefer: "return=representation",
  });
  return row;
}
