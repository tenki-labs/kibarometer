// Flash via query string: ?flash_ok=… / ?flash_error=…. Server actions
// redirect with the QS, the layout's <Flash /> reads from `searchParams`
// and renders a shadcn Alert. PRG-friendly, no client JS.

export type Flash = { ok?: string; error?: string };

export function flashQs(flash: Flash): string {
  const qs = new URLSearchParams();
  if (flash.ok) qs.set("flash_ok", flash.ok);
  if (flash.error) qs.set("flash_error", flash.error);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export function parseFlash(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): Flash | null {
  if (!searchParams) return null;
  const ok = pickString(searchParams.flash_ok);
  const error = pickString(searchParams.flash_error);
  if (!ok && !error) return null;
  return { ok: ok ?? undefined, error: error ?? undefined };
}

function pickString(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

// Norwegian (Bokmål) date/time formatter. Direct port of
// scripts/admin-sections/shared.js::fmtDateTime.
export function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return "-";
  const dt = new Date(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(dt.getDate())}.${pad(dt.getMonth() + 1)}.${dt.getFullYear()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

export function nullIfEmpty(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
