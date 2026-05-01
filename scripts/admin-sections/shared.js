// scripts/admin-sections/shared.js
// Shared helpers for admin sections. Zero deps, Node 22 builtins only.
// Lifted from tenki minus CRM-domain constants and the knowledge-graph helpers.

export const esc = (v) => String(v ?? "").replace(/[<>&"']/g, (c) => ({
  "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;"
}[c]));

export function html(strings, ...values) {
  return strings.reduce((acc, s, i) => acc + s + (values[i] === undefined ? "" : esc(values[i])), "");
}
export function rawHtml(strings, ...values) {
  return strings.reduce((acc, s, i) => acc + s + (values[i] === undefined ? "" : values[i]), "");
}

// Eyebrow — DM Mono uppercase label. Auto-prefixes `· `.
export const eyebrow = (text) => `<span class="eyebrow">· ${esc(text)}</span>`;
// Page header lockup: eyebrow above an h1.title. First child of every *Inner().
export const pageHead = (kicker, title) =>
  `<div class="titlewrap" style="margin-bottom:1.5rem">${eyebrow(kicker)}<h1 class="title" style="margin:.4rem 0 0">${esc(title)}</h1></div>`;

// Norwegian (Bokmål) date/time formatters.
export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("no-NO") : "-");
export const fmtDateTime = (d) => {
  if (!d) return "-";
  const dt = new Date(d);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(dt.getDate())}.${pad(dt.getMonth() + 1)}.${dt.getFullYear()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
};

// Initials from a name string, max 2 chars. Falls back to "·".
export function initials(name) {
  if (!name) return "·";
  const parts = String(name).split(/[\s@]+/).filter(Boolean);
  return ((parts[0] || "")[0] || "").concat(((parts[1] || "")[0] || "")).toUpperCase() || "·";
}

// Days since a timestamp (rounded down). null/invalid → null.
export function daysSince(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

// Human-readable "when" for list rows: "i går", "tir.", "8d", "12. mar".
const NO_WEEKDAYS = ["søn", "man", "tir", "ons", "tor", "fre", "lør"];
const NO_MONTHS = ["jan", "feb", "mar", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "des"];
export function relativeDay(iso) {
  if (!iso) return "-";
  const t = new Date(iso);
  if (!Number.isFinite(t.getTime())) return "-";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const days = Math.round((today.getTime() - that.getTime()) / 86400000);
  if (days === 0) return "i dag";
  if (days === 1) return "i går";
  if (days < 7) return NO_WEEKDAYS[t.getDay()];
  if (days < 30) return days + "d";
  return t.getDate() + ". " + NO_MONTHS[t.getMonth()];
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

// Flash via query string: ?flash_ok=... or ?flash_error=...
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
export function btn({
  label,
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
} = {}) {
  const cls = ["btn", variant === "ghost" && "ghost", size === "small" && "small"]
    .filter(Boolean).join(" ");
  const aria = ariaLabel ? ` aria-label="${esc(ariaLabel)}"` : "";
  const extra = extraAttrs ? " " + extraAttrs : "";
  if (href) return `<a class="${cls}" href="${esc(href)}"${aria}${extra}>${esc(label)}</a>`;
  const nm = name ? ` name="${esc(name)}"` : "";
  const vl = value !== undefined ? ` value="${esc(value)}"` : "";
  const fa = formaction ? ` formaction="${esc(formaction)}"` : "";
  const fm = formmethod ? ` formmethod="${esc(formmethod)}"` : "";
  const oc = confirm ? ` onclick="return confirm('${esc(confirm).replace(/'/g, "\\'")}')"` : "";
  return `<button type="${esc(type)}" class="${cls}"${nm}${vl}${fa}${fm}${aria}${oc}${extra}>${esc(label)}</button>`;
}
