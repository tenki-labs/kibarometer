// lib/admin/legacy/brreg-processor.test.ts
// Unit tests for brreg-processor.js. Fixtures are minimal-shape facsimiles
// of real /enheter and /roller responses (verified against live brreg API
// during development). Covers:
//   - AS with aksjekapital + vedtektsfestetFormaal (IT, AI in formål)
//   - ENK without aksjekapital (kreativ-media, AI in name)
//   - NUF (foreign-registered branch — atypical fields)
//   - Forening (FLI / membership org — non-IT, no AI)
//   - SN2007 vs SN2025-09 cutover (registration date drives version inference)
//   - Roller: natural-person filter, juridical-person discard, fratraadt skip
//   - Founder-age: youngest-of-the-grace-window vs out-of-window roles

import { describe, expect, it } from "vitest";
import { compileMatchers } from "./nav-processor.js";
import {
  extractFromBrregEntity,
  inferTaxonomyVersion,
  kommunenummerToFylke,
  naceToCategory,
  processRollerPayload,
} from "./brreg-processor.js";

// ---- Test fixtures ------------------------------------------------------

const MATCHERS = compileMatchers([
  { term: "AI", language: "any", category: "concept", match_type: "word" },
  { term: "KI", language: "no", category: "concept", match_type: "word" },
  { term: "kunstig intelligens", language: "no", category: "concept", match_type: "substring" },
  { term: "agentic", language: "any", category: "concept", match_type: "word" },
  { term: "machine learning", language: "en", category: "concept", match_type: "substring" },
]);

const CATEGORY_ROWS = [
  { slug: "it", taxonomy_version: "sn2007", code_prefixes: ["62", "63"], sort_order: 10 },
  { slug: "kreativ-media", taxonomy_version: "sn2007", code_prefixes: ["58","59","60","90","91","92","93"], sort_order: 20 },
  { slug: "tjenester", taxonomy_version: "sn2007", code_prefixes: ["69","70","71","72","73","74","75"], sort_order: 30 },
  { slug: "finans", taxonomy_version: "sn2007", code_prefixes: ["64","65","66"], sort_order: 90 },
  { slug: "annet", taxonomy_version: "sn2007", code_prefixes: [], sort_order: 999 },
  { slug: "it", taxonomy_version: "sn2025-09", code_prefixes: ["62", "63"], sort_order: 10 },
  { slug: "tjenester", taxonomy_version: "sn2025-09", code_prefixes: ["69","70","71","72","73","74","75"], sort_order: 30 },
];

const KOMMUNE_FYLKE = new Map([
  ["03", "Oslo"],
  ["31", "Østfold"],
  ["46", "Vestland"],
  ["50", "Trøndelag"],
]);

const CTX = {
  matchers: MATCHERS,
  categoryRows: CATEGORY_ROWS,
  kommuneFylkeMap: KOMMUNE_FYLKE,
};

// AS in IT (62.010 — programmering) with AI in vedtektsfestetFormaal.
const AS_IT_AI_FORMAAL = {
  organisasjonsnummer: "934111111",
  navn: "Nordic Solutions AS",
  organisasjonsform: { kode: "AS", beskrivelse: "Aksjeselskap" },
  registreringsdatoEnhetsregisteret: "2025-03-12",
  stiftelsesdato: "2025-02-20",
  naeringskode1: { kode: "62.010", beskrivelse: "Programmeringstjenester" },
  forretningsadresse: { kommunenummer: "0301", postnummer: "0150", poststed: "OSLO" },
  aktivitet: ["Programvareutvikling for konsulentmarkedet."],
  vedtektsfestetFormaal: [
    "Utvikling av kunstig intelligens-baserte løsninger for små og mellomstore bedrifter.",
  ],
  kapital: { type: "Aksjekapital", valuta: "NOK", belop: 100000, antallAksjer: 1000 },
  konkurs: false,
  underAvvikling: false,
};

// ENK in kreativ-media (90.030 — selvstendig kunstnerisk) with AI in NAME.
const ENK_KREATIV_AI_NAME = {
  organisasjonsnummer: "934222222",
  navn: "Bjørn AI Studio",
  organisasjonsform: { kode: "ENK", beskrivelse: "Enkeltpersonforetak" },
  registreringsdatoEnhetsregisteret: "2025-04-01",
  naeringskode1: { kode: "90.030", beskrivelse: "Selvstendig kunstnerisk virksomhet" },
  forretningsadresse: { kommunenummer: "4601", postnummer: "5003", poststed: "BERGEN" },
  aktivitet: ["Foto og videoproduksjon."],
  konkurs: false,
};

// NUF (foreign-registered branch). Sometimes lacks naeringskode1 entirely;
// our processor must not crash and must default to "annet".
const NUF_NO_NACE = {
  organisasjonsnummer: "934333333",
  navn: "OFFSHORE EXAMPLE NUF",
  organisasjonsform: { kode: "NUF", beskrivelse: "Norskregistrert utenlandsk foretak" },
  registreringsdatoEnhetsregisteret: "2024-08-22",
  forretningsadresse: { kommunenummer: "5001" },
  aktivitet: [],
  konkurs: false,
};

// FLI (forening / membership org). Non-IT, no AI signals at all.
const FLI_FORENING = {
  organisasjonsnummer: "934444444",
  navn: "Trondheim Bridgeklubb",
  organisasjonsform: { kode: "FLI", beskrivelse: "Forening/lag/innretning" },
  registreringsdatoEnhetsregisteret: "2024-11-04",
  naeringskode1: { kode: "94.991", beskrivelse: "Aktiviteter i andre interesseorganisasjoner" },
  forretningsadresse: { kommunenummer: "5001" },
  aktivitet: ["Kortspillaktiviteter."],
  konkurs: false,
};

// SN2025-09 cutover: registered post-2025-09-01 → taxonomy_version='sn2025-09'.
const AS_POST_CUTOVER = {
  ...AS_IT_AI_FORMAAL,
  organisasjonsnummer: "934555555",
  navn: "Future Agentic AS",
  registreringsdatoEnhetsregisteret: "2025-10-15",
  vedtektsfestetFormaal: ["Agentic infrastructure for enterprise."],
};

// ---- inferTaxonomyVersion ----------------------------------------------

describe("inferTaxonomyVersion", () => {
  it("returns sn2007 for pre-cutover dates", () => {
    expect(inferTaxonomyVersion("2024-01-01")).toBe("sn2007");
    expect(inferTaxonomyVersion("2025-08-31")).toBe("sn2007");
  });
  it("returns sn2025-09 for cutover date and later", () => {
    expect(inferTaxonomyVersion("2025-09-01")).toBe("sn2025-09");
    expect(inferTaxonomyVersion("2026-01-15")).toBe("sn2025-09");
  });
  it("falls back to sn2007 for missing date", () => {
    expect(inferTaxonomyVersion(null)).toBe("sn2007");
    expect(inferTaxonomyVersion(undefined)).toBe("sn2007");
  });
});

// ---- naceToCategory -----------------------------------------------------

describe("naceToCategory", () => {
  it("maps IT codes (62.x, 63.x) to 'it'", () => {
    expect(naceToCategory("62.010", "sn2007", CATEGORY_ROWS)).toBe("it");
    expect(naceToCategory("63.110", "sn2007", CATEGORY_ROWS)).toBe("it");
  });
  it("maps creative codes (90.x) to 'kreativ-media'", () => {
    expect(naceToCategory("90.030", "sn2007", CATEGORY_ROWS)).toBe("kreativ-media");
  });
  it("maps consultancy (69-75) to 'tjenester'", () => {
    expect(naceToCategory("70.220", "sn2007", CATEGORY_ROWS)).toBe("tjenester");
    expect(naceToCategory("74.100", "sn2007", CATEGORY_ROWS)).toBe("tjenester");
  });
  it("falls back to 'annet' for unmapped prefix", () => {
    expect(naceToCategory("94.991", "sn2007", CATEGORY_ROWS)).toBe("annet");
    expect(naceToCategory(null, "sn2007", CATEGORY_ROWS)).toBe("annet");
  });
  it("respects taxonomy_version (no cross-version match)", () => {
    // 'finans' only seeded under sn2007 in this fixture; sn2025-09 lookup
    // for 64.x must NOT find it via the sn2007 row.
    expect(naceToCategory("64.190", "sn2007", CATEGORY_ROWS)).toBe("finans");
    expect(naceToCategory("64.190", "sn2025-09", CATEGORY_ROWS)).toBe("annet");
  });
});

// ---- kommunenummerToFylke ----------------------------------------------

describe("kommunenummerToFylke", () => {
  it("maps known prefixes", () => {
    expect(kommunenummerToFylke("0301", KOMMUNE_FYLKE)).toBe("Oslo");
    expect(kommunenummerToFylke("4601", KOMMUNE_FYLKE)).toBe("Vestland");
    expect(kommunenummerToFylke("5001", KOMMUNE_FYLKE)).toBe("Trøndelag");
  });
  it("returns null for unknown prefix or missing input", () => {
    expect(kommunenummerToFylke("9999", KOMMUNE_FYLKE)).toBeNull();
    expect(kommunenummerToFylke(null, KOMMUNE_FYLKE)).toBeNull();
    expect(kommunenummerToFylke("0301", null as unknown as Map<string, string>)).toBeNull();
  });
});

// ---- extractFromBrregEntity --------------------------------------------

describe("extractFromBrregEntity", () => {
  it("returns null for malformed (no orgnr) input", () => {
    expect(extractFromBrregEntity({}, CTX)).toBeNull();
  });

  it("AS in IT with AI in formål: tags has_ai_in_aktivitet, captures aksjekapital", () => {
    const row = extractFromBrregEntity(AS_IT_AI_FORMAAL, CTX);
    expect(row).not.toBeNull();
    expect(row!.orgnr).toBe("934111111");
    expect(row!.organisasjonsform).toBe("AS");
    expect(row!.naeringskode_1).toBe("62.010");
    expect(row!.naeringskode_taxonomy_version).toBe("sn2007");
    expect(row!.nace_category_slug).toBe("it");
    expect(row!.fylke).toBe("Oslo");
    expect(row!.aksjekapital).toBe(100000);
    // Tagging: AI not in name; "kunstig intelligens" hits aktivitet (joined formål).
    expect(row!.has_ai_in_name).toBe(false);
    expect(row!.has_ai_in_aktivitet).toBe(true);
    expect(row!.matched_keywords_aktivitet).toContain("kunstig intelligens");
    // aktivitet column carries both arrays joined.
    expect(row!.aktivitet).toContain("Programvareutvikling");
    expect(row!.aktivitet).toContain("kunstig intelligens");
  });

  it("ENK in kreativ-media with AI in name: tags has_ai_in_name, no aksjekapital", () => {
    const row = extractFromBrregEntity(ENK_KREATIV_AI_NAME, CTX);
    expect(row).not.toBeNull();
    expect(row!.organisasjonsform).toBe("ENK");
    expect(row!.aksjekapital).toBeNull();
    expect(row!.nace_category_slug).toBe("kreativ-media");
    expect(row!.fylke).toBe("Vestland");
    expect(row!.has_ai_in_name).toBe(true);
    expect(row!.matched_keywords_name).toContain("AI");
    expect(row!.has_ai_in_aktivitet).toBe(false);
  });

  it("NUF without naeringskode falls back to 'annet' without crashing", () => {
    const row = extractFromBrregEntity(NUF_NO_NACE, CTX);
    expect(row).not.toBeNull();
    expect(row!.organisasjonsform).toBe("NUF");
    expect(row!.naeringskode_1).toBeNull();
    expect(row!.nace_category_slug).toBe("annet");
    // "OFFSHORE EXAMPLE NUF" — bare-acronym matchers are word-boundary
    // sensitive; "NUF" is not in the matcher list.
    expect(row!.has_ai_in_name).toBe(false);
  });

  it("FLI forening: non-IT, no AI signals", () => {
    const row = extractFromBrregEntity(FLI_FORENING, CTX);
    expect(row).not.toBeNull();
    expect(row!.organisasjonsform).toBe("FLI");
    expect(row!.nace_category_slug).toBe("annet"); // 94.x not seeded as a category
    expect(row!.has_ai_in_name).toBe(false);
    expect(row!.has_ai_in_aktivitet).toBe(false);
    expect(row!.aksjekapital).toBeNull();
  });

  it("SN2025-09 post-cutover entity: taxonomy_version flips to sn2025-09", () => {
    const row = extractFromBrregEntity(AS_POST_CUTOVER, CTX);
    expect(row).not.toBeNull();
    expect(row!.naeringskode_taxonomy_version).toBe("sn2025-09");
    expect(row!.nace_category_slug).toBe("it"); // mapped via sn2025-09 row
    // "Agentic" matches the brreg-seeded keyword; should hit either name
    // (agentic) or aktivitet (agentic in formål).
    expect(
      row!.has_ai_in_name || row!.has_ai_in_aktivitet
    ).toBe(true);
  });
});

// ---- processRollerPayload ----------------------------------------------

describe("processRollerPayload", () => {
  it("filters out juridical-person role-holders", () => {
    const payload = {
      rollegrupper: [
        {
          type: { kode: "STYR" },
          sistEndret: "2025-03-15",
          roller: [
            {
              type: { kode: "STYR" },
              fratraadt: false,
              avregistrert: false,
              // Juridical: enhet present, no person.
              enhet: { organisasjonsnummer: "999888777", navn: "Holding Co AS" },
            },
            {
              type: { kode: "MEDL" },
              fratraadt: false,
              person: {
                fodselsdato: "1990-05-12",
                navn: { fornavn: "Anna", etternavn: "Berg" },
              },
            },
          ],
        },
      ],
    };
    const r = processRollerPayload("934111111", payload, "2025-03-12");
    expect(r.role_count).toBe(1);
    expect(r.roles[0].person_navn).toBe("Anna Berg");
  });

  it("skips fratraadt and avregistrert roles", () => {
    const payload = {
      rollegrupper: [
        {
          type: { kode: "DAGL" },
          sistEndret: "2025-03-15",
          roller: [
            {
              type: { kode: "DAGL" },
              fratraadt: true,
              person: {
                fodselsdato: "1985-01-01",
                navn: { fornavn: "Old", etternavn: "Boss" },
              },
            },
            {
              type: { kode: "DAGL" },
              avregistrert: true,
              person: {
                fodselsdato: "1986-01-01",
                navn: { fornavn: "Removed", etternavn: "Boss" },
              },
            },
          ],
        },
      ],
    };
    const r = processRollerPayload("934111111", payload, "2025-03-12");
    expect(r.role_count).toBe(0);
    expect(r.youngest_age_at_reg).toBeNull();
  });

  it("computes youngest age at registration for in-grace-window roles", () => {
    // Reg date 2025-03-12. Three eligible roles:
    //   - styreleder, born 1980-01-01, role filed 2025-03-12 → age 45
    //   - styremedlem, born 2003-06-15, role filed 2025-03-20 (in grace) → age 21
    //   - varamedlem (VARA, NOT enrichable), born 2002-01-01 → ignored
    const payload = {
      rollegrupper: [
        {
          type: { kode: "STYR" },
          sistEndret: "2025-03-12",
          roller: [
            {
              type: { kode: "STYR" },
              person: { fodselsdato: "1980-01-01", navn: { fornavn: "A", etternavn: "Senior" } },
            },
          ],
        },
        {
          type: { kode: "MEDL" },
          sistEndret: "2025-03-20",
          roller: [
            {
              type: { kode: "MEDL" },
              person: { fodselsdato: "2003-06-15", navn: { fornavn: "Young", etternavn: "Founder" } },
            },
          ],
        },
        {
          type: { kode: "VARA" },
          sistEndret: "2025-03-12",
          roller: [
            {
              type: { kode: "VARA" },
              person: { fodselsdato: "2002-01-01", navn: { fornavn: "Vara", etternavn: "Person" } },
            },
          ],
        },
      ],
    };
    const r = processRollerPayload("934111111", payload, "2025-03-12");
    // 3 natural-person roles persisted (including VARA — we still store it
    // for the admin browser; it just doesn't feed founder-age math).
    expect(r.role_count).toBe(3);
    // Youngest among ENRICHABLE (STYR/MEDL) within 30-day grace.
    expect(r.youngest_age_at_reg).toBe(21);
  });

  it("ignores roles filed long after registration (out of grace window)", () => {
    // Reg 2025-03-12; replacement DAGL filed 2026-01-15 (≈10 months later).
    // Replacement DOB 2005-01-01 (would be 21 at the LATER role-filing date,
    // but founder-age uses registration date, not role date — and the
    // out-of-grace filter excludes this role from the youngest calc anyway).
    const payload = {
      rollegrupper: [
        {
          type: { kode: "DAGL" },
          sistEndret: "2025-03-12",
          roller: [
            {
              type: { kode: "DAGL" },
              person: { fodselsdato: "1980-01-01", navn: { fornavn: "Original", etternavn: "DAGL" } },
            },
          ],
        },
        {
          type: { kode: "DAGL" },
          sistEndret: "2026-01-15",
          roller: [
            {
              type: { kode: "DAGL" },
              person: { fodselsdato: "2005-01-01", navn: { fornavn: "Replacement", etternavn: "DAGL" } },
            },
          ],
        },
      ],
    };
    const r = processRollerPayload("934111111", payload, "2025-03-12");
    expect(r.role_count).toBe(2);
    // Original DAGL at reg date: born 1980-01-01, registered 2025-03-12 → 45.
    // Replacement is out-of-grace and excluded from the youngest-age math.
    expect(r.youngest_age_at_reg).toBe(45);
  });

  it("returns null age + zero roles for an empty payload", () => {
    const r = processRollerPayload("934111111", { rollegrupper: [] }, "2025-03-12");
    expect(r.role_count).toBe(0);
    expect(r.youngest_age_at_reg).toBeNull();
    expect(r.roles).toEqual([]);
  });
});
