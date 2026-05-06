// lib/admin/legacy/brreg-processor.js
// Pure-function module that turns brreg API responses into brreg_companies +
// brreg_roles rows. Reuses applyTags/compileMatchers from nav-processor for
// keyword tagging — the same matcher set is run twice per company (once on
// `navn`, once on `aktivitet`+`vedtektsfestetFormaal`). Zero deps,
// Node 22 builtins only.
//
// Three callers:
//   1. extractFromBrregEntity(entity, ctx) — turns one /enheter list-response
//      item into a brreg_companies row (no roles yet; roles are fetched
//      lazily by the role-fetch worker for enrich_roles=true categories).
//   2. processRollerPayload(orgnr, payload, registrertDato) — turns one
//      /roller response into a list of brreg_roles rows (natural persons
//      only) plus the computed youngest_role_age_at_reg.
//   3. naceToCategory(naeringskode, taxonomy_version, categoryRows) —
//      maps an entity's naeringskode_1 → kibarometer category slug.

import { applyTags } from "./nav-processor.js";

// SN2025-09 became active 2025-09-01. Pre-cutoff entities were coded in
// SN2007; post-cutoff in SN2025-09. brreg may eventually re-tag old
// entities with the new taxonomy, but for now we infer the version
// from the registration date.
const SN2025_CUTOVER = "2025-09-01";

// Roles that count as "founder-era" for the youngest-age computation.
// DAGL = daglig leder, STYR = styreleder, MEDL = styremedlem,
// NEST = nestleder, INNH = innehaver (ENK).
const ENRICH_ROLE_CODES = new Set(["DAGL", "STYR", "MEDL", "NEST", "INNH"]);

// 30-day grace window: a role filed within reg+30d still counts as
// "founder-era" for age computation. Catches the common case where an
// AS is registered first and the board is filed a week later.
const FOUNDER_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

// ---- Taxonomy version --------------------------------------------------

export function inferTaxonomyVersion(registrertDato) {
  if (!registrertDato) return "sn2007";
  return registrertDato >= SN2025_CUTOVER ? "sn2025-09" : "sn2007";
}

// ---- NACE category mapping ---------------------------------------------

// categoryRows: [{slug, taxonomy_version, code_prefixes:[…], sort_order}]
// First match wins (caller should pre-sort by sort_order ASC). Falls back
// to "annet" when no prefix matches.
export function naceToCategory(naeringskode, taxonomyVersion, categoryRows) {
  if (!naeringskode || !Array.isArray(categoryRows) || categoryRows.length === 0) {
    return "annet";
  }
  const prefix2 = String(naeringskode).slice(0, 2);
  for (const row of categoryRows) {
    if (row.taxonomy_version !== taxonomyVersion) continue;
    if (Array.isArray(row.code_prefixes) && row.code_prefixes.includes(prefix2)) {
      return row.slug;
    }
  }
  return "annet";
}

// ---- Kommune → fylke ---------------------------------------------------

// kommuneFylkeMap: Map<prefix2, fylke_label_no> built once per batch by
// the orchestrator from the public.kommune_fylke seed.
export function kommunenummerToFylke(kommunenummer, kommuneFylkeMap) {
  if (!kommunenummer || !(kommuneFylkeMap instanceof Map)) return null;
  const prefix2 = String(kommunenummer).slice(0, 2);
  return kommuneFylkeMap.get(prefix2) || null;
}

// ---- Entity → row ------------------------------------------------------

// extracts a brreg_companies row from one /enheter list-response item.
// Returns null when orgnr is missing.
//
// ctx provides:
//   matchers         — compiled keyword matchers (from nav-processor.compileMatchers)
//   categoryRows     — nace_categories rows (both taxonomy versions, sorted)
//   kommuneFylkeMap  — Map<prefix2, fylke_label_no>
export function extractFromBrregEntity(entity, ctx) {
  const orgnr = entity?.organisasjonsnummer;
  if (!orgnr) return null;
  const navn = entity?.navn || "";

  const orgform = entity?.organisasjonsform?.kode || null;
  const registrert_dato = entity?.registreringsdatoEnhetsregisteret || null;
  const stiftelsesdato = entity?.stiftelsesdato || null;
  // brreg uses `slettedato` (no underscore) on deleted entities. Active
  // entities omit the field entirely.
  const slettet_dato = entity?.slettedato || null;

  const naeringskode_1 = entity?.naeringskode1?.kode || null;
  const naeringskode_2 = entity?.naeringskode2?.kode || null;
  const naeringskode_3 = entity?.naeringskode3?.kode || null;
  const taxonomy_version = inferTaxonomyVersion(registrert_dato);
  const nace_category_slug = naceToCategory(naeringskode_1, taxonomy_version, ctx?.categoryRows || []);

  const fa = entity?.forretningsadresse || {};
  const kommunenummer = fa?.kommunenummer || null;
  const postnummer = fa?.postnummer || null;
  const poststed = fa?.poststed || null;
  const fylke = kommunenummerToFylke(kommunenummer, ctx?.kommuneFylkeMap || new Map());

  // brreg returns an explicit antallAnsatte only when harRegistrertAntallAnsatte
  // is true; otherwise the field is omitted (privacy bracket for 0–4).
  const antall_ansatte =
    typeof entity?.antallAnsatte === "number" ? entity.antallAnsatte : null;

  // Aksjekapital: only AS / ASA entities expose this; the field is `kapital`
  // with `{belop, antallAksjer, type, valuta, innfortDato}`. Guard on
  // type=Aksjekapital + valuta=NOK so we never accidentally store a
  // non-NOK figure as if it were NOK.
  const aksjekapital =
    entity?.kapital &&
    entity.kapital?.type === "Aksjekapital" &&
    entity.kapital?.valuta === "NOK" &&
    typeof entity.kapital?.belop === "number"
      ? Number(entity.kapital.belop)
      : null;

  // aktivitet is an array of strings; vedtektsfestetFormaal often carries
  // the more substantive purpose statement on AS. Concatenate both before
  // tagging so an AI-substance venture whose formal purpose mentions AI
  // but the casual aktivitet doesn't, still gets flagged.
  const aktivitet_arr = Array.isArray(entity?.aktivitet) ? entity.aktivitet : [];
  const formaal_arr = Array.isArray(entity?.vedtektsfestetFormaal)
    ? entity.vedtektsfestetFormaal
    : [];
  const aktivitet_combined = [...aktivitet_arr, ...formaal_arr].join(" ").trim();
  const aktivitet = aktivitet_combined || null;

  const konkurs = !!entity?.konkurs;
  const under_avvikling =
    !!entity?.underAvvikling || !!entity?.underTvangsavviklingEllerTvangsopplosning;

  // Keyword tagging: name + aktivitet (separately tracked).
  const matchers = Array.isArray(ctx?.matchers) ? ctx.matchers : [];
  const nameTag = applyTags(navn, matchers);
  const aktTag = aktivitet
    ? applyTags(aktivitet, matchers)
    : { is_ai: false, matched_keywords: [] };

  return {
    orgnr,
    navn,
    organisasjonsform: orgform,
    registrert_dato,
    stiftelsesdato,
    slettet_dato,
    naeringskode_1,
    naeringskode_2,
    naeringskode_3,
    naeringskode_taxonomy_version: taxonomy_version,
    nace_category_slug,
    kommunenummer,
    postnummer,
    poststed,
    fylke,
    antall_ansatte,
    aksjekapital,
    aktivitet,
    konkurs,
    under_avvikling,
    has_ai_in_name: nameTag.is_ai,
    has_ai_in_aktivitet: aktTag.is_ai,
    matched_keywords_name: nameTag.matched_keywords,
    matched_keywords_aktivitet: aktTag.matched_keywords,
    raw_jsonb: entity,
  };
}

// ---- Roller payload → roles[] + computed age ---------------------------

// Computes age in completed years between two YYYY-MM-DD dates.
// Returns null when either date is missing or the age is implausible.
function ageInYears(dobStr, asOfStr) {
  if (!dobStr || !asOfStr) return null;
  const dob = new Date(dobStr);
  const asOf = new Date(asOfStr);
  if (Number.isNaN(dob.getTime()) || Number.isNaN(asOf.getTime())) return null;
  let age = asOf.getUTCFullYear() - dob.getUTCFullYear();
  const m = asOf.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && asOf.getUTCDate() < dob.getUTCDate())) age -= 1;
  if (age < 0 || age > 130) return null;
  return age;
}

// Pulls only natural persons from the roller payload. Filters out
// fratraadt (resigned) and avregistrert roles. Returns:
//   { roles: [{ orgnr, role_code, person_navn, fodselsdato, valid_from }],
//     youngest_age_at_reg: smallint | null,
//     role_count: number }
//
// Juridical role-holders (holding companies on the board) are dropped per
// the privacy plan — they have no DOB, can't contribute to founder-age
// math, and storing them adds noise without analytical value.
export function processRollerPayload(orgnr, payload, registrertDato) {
  const groups = Array.isArray(payload?.rollegrupper) ? payload.rollegrupper : [];
  const rows = [];
  let youngestAge = null;
  const regMs = registrertDato ? new Date(registrertDato).getTime() : null;
  const graceCutoffMs =
    Number.isFinite(regMs) && !Number.isNaN(regMs) ? regMs + FOUNDER_GRACE_MS : null;

  for (const grp of groups) {
    const validFrom = grp?.sistEndret || null;
    const grpRoles = Array.isArray(grp?.roller) ? grp.roller : [];
    for (const r of grpRoles) {
      if (r?.fratraadt || r?.avregistrert) continue;
      const code = r?.type?.kode;
      if (!code) continue;
      const person = r?.person;
      if (!person) continue; // juridical person — skip per privacy plan
      const fdato = person?.fodselsdato;
      if (!fdato) continue; // can't do age math without DOB
      const fornavn = person?.navn?.fornavn || "";
      const etternavn = person?.navn?.etternavn || "";
      const personNavn = `${fornavn} ${etternavn}`.trim();
      if (!personNavn) continue;
      rows.push({
        orgnr,
        role_code: code,
        person_navn: personNavn,
        fodselsdato: fdato,
        valid_from: validFrom,
      });
      // Founder-age contribution: only enrichable role codes filed within
      // reg+30d. Skip when we lack a registration date to compute against.
      if (!ENRICH_ROLE_CODES.has(code)) continue;
      if (graceCutoffMs === null || !validFrom) continue;
      const validMs = new Date(validFrom).getTime();
      if (Number.isNaN(validMs) || validMs > graceCutoffMs) continue;
      const age = ageInYears(fdato, registrertDato);
      if (age !== null) {
        if (youngestAge === null || age < youngestAge) youngestAge = age;
      }
    }
  }
  return {
    roles: rows,
    youngest_age_at_reg: youngestAge,
    role_count: rows.length,
  };
}
