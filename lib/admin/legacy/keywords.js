// lib/admin/legacy/keywords.js
// Validation + CRUD for the keyword inclusion list. Ported from
// scripts/admin-sections/keywords.js — only the HTML rendering (listInner,
// detailInner, categorySection, newForm, badge helpers) was dropped; those
// are TSX in app/admin/keywords/.
//
// Soft-delete via status='rejected' (was is_active=false in 0014/earlier).
// Preserves any matched_keywords[] arrays in nav_postings rows that already
// reference the term. Trial keywords (status='trial', PR 6) match in tagging
// but are excluded from public is_ai stats at snapshot time.

export const LANGUAGES = ["any", "no", "en"];
export const CATEGORIES = ["tool", "role", "concept"];
export const MATCH_TYPES = ["word", "substring"];
export const STATUSES = ["canonical", "trial", "rejected"];

export const CATEGORY_LABEL = {
  tool: "Verktøy",
  role: "Rolle / tittel",
  concept: "Begrep",
};
export const LANGUAGE_LABEL = { any: "alle", no: "norsk", en: "engelsk" };
export const MATCH_LABEL = { word: "ord", substring: "delstreng" };

export const SELECT_COLS =
  "id,term,language,category,match_type,status,notes,created_at,updated_at";

function nullIfEmpty(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export function validatePayload(body, { partial = false } = {}) {
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
    if (/duplicate key|already exists|23505/.test(err.message)) {
      throw new Error(
        `"${payload.term}" finnes allerede for ${LANGUAGE_LABEL[payload.language]}`,
      );
    }
    throw err;
  }
}

export async function update({ sb, id, body }) {
  const payload = validatePayload(body);
  // The edit form posts a boolean checkbox for backwards compatibility with
  // the PR 1 UI. PR 6 replaces this with a tri-state status select.
  const checked =
    body.is_active === "1" ||
    body.is_active === "on" ||
    body.is_active === true;
  payload.status = checked ? "canonical" : "rejected";
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
  const [current] = await sb(
    `/keywords?id=eq.${encodeURIComponent(id)}&select=status`,
    { service: true },
  );
  if (!current) throw new Error("Ikke funnet");
  // canonical/trial → rejected, rejected → canonical. Trial rows demoting
  // to rejected via this affordance is intentional (the explicit demote
  // path in /admin/keywords/candidates lands in PR 6).
  const next = current.status === "rejected" ? "canonical" : "rejected";
  const [row] = await sb(`/keywords?id=eq.${encodeURIComponent(id)}`, {
    service: true,
    method: "PATCH",
    body: { status: next },
    prefer: "return=representation",
  });
  return row;
}
