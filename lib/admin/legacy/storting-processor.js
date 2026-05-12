// lib/admin/legacy/storting-processor.js
// Pure-function module that turns Stortinget API responses into
// storting_saker + storting_vedtak rows. Reuses applyTags/compileMatchers
// from nav-processor for keyword tagging. Zero deps, Node 22 builtins only.
//
// Four callers:
//   1. loadActiveOffentligKeywords(sb) — fetches active keywords filtered to
//      domain=in.(offentlig,any) for the storting matcher.
//   2. buildSakRow(sak, ctx) — turns one /eksport/saker entry into a
//      storting_saker row. ctx carries { matchers, sesjon_id }. sesjon_id
//      comes from the orchestrator (the saker_liste response itself does
//      not repeat it on each entry).
//   3. buildVedtakRow(vedtak, ctx) — turns one /eksport/stortingsvedtak
//      entry into a storting_vedtak row. HTML strip on stortingsvedtak_tekst
//      happens here.
//   4. stripHtml(s) — exported for tests / retag jobs that re-run the
//      matcher without re-fetching.

import { applyTags } from "./nav-processor.js";

// ---- Keyword loader ----------------------------------------------------

// /offentlig keywords filter to (offentlig, any). The same canonical AI
// vocabulary that's domain='any' will surface here; pillar-specific terms
// added via /admin/keywords with domain='offentlig' will too.
export async function loadActiveOffentligKeywords(sb) {
  return sb(
    "/keywords?status=in.(canonical,trial)&domain=in.(offentlig,any)" +
      "&select=term,language,category,match_type",
    { service: true },
  );
}

// ---- HTML strip --------------------------------------------------------

// Strip HTML tags + decode the small set of named entities Stortinget's
// vedtak payloads use. NOT a full HTML parser — we just need plain text
// the keyword matcher can scan. The stripped form is NOT persisted; the
// raw HTML lives in storting_vedtak.tekst so a retag re-strips for free.
export function stripHtml(s) {
  if (typeof s !== "string" || !s) return "";
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// ---- Sak → row ---------------------------------------------------------

// Extracts a storting_saker row from one /eksport/saker entry. Returns
// null when sak.id is missing or zero.
//
// ctx provides:
//   matchers   — compiled keyword matchers (compileMatchers output)
//   sesjon_id  — session id to stamp on the row (the saker_liste entries
//                don't repeat it; the orchestrator knows which session it
//                queried)
export function buildSakRow(sak, ctx) {
  const sak_id = sak?.id;
  if (!sak_id || typeof sak_id !== "number") return null;

  const tittel = String(sak?.tittel || "").trim();
  if (!tittel) return null; // tittel is NOT NULL in the schema

  const korttittel = sak?.korttittel ? String(sak.korttittel).trim() : null;
  const henvisning = sak?.henvisning ? String(sak.henvisning).trim() : null;

  const type_kode = toSmallint(sak?.type);
  const status_kode = toSmallint(sak?.status);
  const dokumentgruppe_kode = toSmallint(sak?.dokumentgruppe);
  const innstilling_id = toBigintOrNull(sak?.innstilling_id);
  const innstilling_kode = toSmallint(sak?.innstilling_kode);
  const sak_fremmet_id = toBigintOrNull(sak?.sak_fremmet_id);

  const behandlet_sesjon_id = sak?.behandlet_sesjon_id || null;
  const sist_oppdatert_dato = isoDate(sak?.sist_oppdatert_dato);

  const komite_id = toBigintOrNull(sak?.komite?.id);
  const komite_navn = sak?.komite?.navn ? String(sak.komite.navn).trim() : null;

  const forslagstiller_liste = Array.isArray(sak?.forslagstiller_liste)
    ? sak.forslagstiller_liste
    : null;
  const emne_liste = Array.isArray(sak?.emne_liste) ? sak.emne_liste : null;
  const saksordfoerer_liste = Array.isArray(sak?.saksordfoerer_liste)
    ? sak.saksordfoerer_liste
    : null;

  // Keyword tagging
  const matchers = Array.isArray(ctx?.matchers) ? ctx.matchers : [];
  const titleHaystack = [tittel, korttittel || ""].filter(Boolean).join(" ");
  const emnerHaystack = (emne_liste || [])
    .map((e) => String(e?.navn || ""))
    .concat(
      (emne_liste || []).flatMap((e) =>
        Array.isArray(e?.underemne_liste)
          ? e.underemne_liste.map((u) => String(u?.navn || ""))
          : [],
      ),
    )
    .filter(Boolean)
    .join(" ");

  const titleTag = applyTags(titleHaystack, matchers);
  const emnerTag = emnerHaystack
    ? applyTags(emnerHaystack, matchers)
    : { is_ai: false, matched_keywords: [] };

  return {
    sak_id,
    tittel,
    korttittel,
    henvisning,
    type_kode,
    status_kode,
    dokumentgruppe_kode,
    innstilling_id,
    innstilling_kode,
    sak_fremmet_id,
    sesjon_id: ctx?.sesjon_id || null,
    behandlet_sesjon_id,
    sist_oppdatert_dato,
    komite_id,
    komite_navn,
    forslagstiller_liste,
    emne_liste,
    saksordfoerer_liste,
    has_ai_in_title: titleTag.is_ai,
    has_ai_in_emner: emnerTag.is_ai,
    matched_keywords_title: titleTag.matched_keywords,
    matched_keywords_emner: emnerTag.matched_keywords,
    raw_jsonb: sak,
  };
}

// ---- Vedtak → row ------------------------------------------------------

// Extracts a storting_vedtak row from one /eksport/stortingsvedtak entry.
// Returns null when vedtak.id is missing. HTML strip runs only to compute
// the keyword tag; the raw HTML is persisted in `tekst`.
//
// ctx provides:
//   matchers   — compiled keyword matchers
//   sesjon_id  — session id (vedtak entries do not carry it per-row)
export function buildVedtakRow(vedtak, ctx) {
  const vedtak_id = vedtak?.id;
  if (!vedtak_id || typeof vedtak_id !== "number") return null;

  const sak_id = toBigintOrNull(vedtak?.sak_id);
  const dato_tid = vedtak?.stortingsvedtak_dato_tid || null;
  const nummer = toSmallint(vedtak?.stortingsvedtak_nummer);
  const tittel = vedtak?.stortingsvedtak_tittel
    ? String(vedtak.stortingsvedtak_tittel).trim()
    : null;
  const tekst = vedtak?.stortingsvedtak_tekst
    ? String(vedtak.stortingsvedtak_tekst)
    : null;

  // stortingsvedtak_type is { id: "ANMOD", navn: "..." }. id is the
  // analytically useful slug, navn is the display label.
  const type_id = vedtak?.stortingsvedtak_type?.id
    ? String(vedtak.stortingsvedtak_type.id).trim()
    : null;
  const type_navn = vedtak?.stortingsvedtak_type?.navn
    ? String(vedtak.stortingsvedtak_type.navn).trim()
    : null;

  const sak_lenke_url = vedtak?.sak_lenke_url || null;
  const vedtak_lenke_url = vedtak?.stortingsvedtak_lenke_url || null;

  // Keyword tagging on stripped text
  const matchers = Array.isArray(ctx?.matchers) ? ctx.matchers : [];
  const stripped = stripHtml(tekst);
  const haystack = [tittel || "", stripped].filter(Boolean).join(" ");
  const tag = haystack ? applyTags(haystack, matchers) : { is_ai: false, matched_keywords: [] };

  return {
    vedtak_id,
    sak_id,
    sesjon_id: ctx?.sesjon_id || null,
    nummer,
    dato_tid,
    tittel,
    tekst,
    type_id,
    type_navn,
    sak_lenke_url,
    vedtak_lenke_url,
    has_ai_in_text: tag.is_ai,
    matched_keywords: tag.matched_keywords,
    raw_jsonb: vedtak,
  };
}

// ---- helpers -----------------------------------------------------------

function toSmallint(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  // smallint range -32768..32767. Stortinget codes are tiny one- or two-digit
  // numbers; out-of-range values would be a sign of upstream shape change.
  if (n < -32768 || n > 32767) return null;
  return Math.trunc(n);
}

function toBigintOrNull(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function isoDate(v) {
  if (!v) return null;
  // Stortinget already returns ISO YYYY-MM-DD or full ISO timestamp; we
  // only need the date portion for sist_oppdatert_dato.
  const s = String(v);
  return s.slice(0, 10);
}
