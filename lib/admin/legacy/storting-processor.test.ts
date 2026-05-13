// lib/admin/legacy/storting-processor.test.ts
// Unit tests for storting-processor.js + storting-client.js. Fixtures are
// minimal-shape facsimiles of real /eksport/saker and /eksport/stortingsvedtak
// responses (verified live 2026-05-12). Covers:
//   - sak with AI keyword in title vs emner vs neither
//   - sak with missing required fields → null
//   - vedtak with HTML tekst → strip-then-match
//   - stripHtml entity decoding
//   - currentSessionId boundary (October cutover)
//   - enumerateSessions walking direction

import { describe, expect, it } from "vitest";
import { compileMatchers } from "./nav-processor.js";
import {
  buildSakRow,
  buildVedtakRow,
  parseStortingDate,
  parseStortingTimestamp,
  stripHtml,
} from "./storting-processor.js";
import {
  currentSessionId,
  enumerateSessions,
} from "./storting-client.js";

const MATCHERS = compileMatchers([
  { term: "AI", language: "any", category: "concept", match_type: "word" },
  { term: "KI", language: "no", category: "concept", match_type: "word" },
  { term: "kunstig intelligens", language: "no", category: "concept", match_type: "substring" },
  { term: "maskinlæring", language: "no", category: "concept", match_type: "substring" },
]);

const CTX = { matchers: MATCHERS, sesjon_id: "2024-2025" };

// Realistic-shape sak with AI in title.
const SAK_AI_TITLE = {
  id: 100001,
  tittel: "Forslag om nasjonal strategi for kunstig intelligens",
  korttittel: null,
  henvisning: "Innst. 42 S",
  dokumentgruppe: 1,
  type: 0,
  status: 4,
  innstilling_id: 99999,
  innstilling_kode: 12,
  sak_fremmet_id: 42,
  behandlet_sesjon_id: "2024-2025",
  sist_oppdatert_dato: "2024-12-15T00:00:00",
  komite: { id: 7, navn: "Næringskomiteen" },
  forslagstiller_liste: [{ id: 1, fornavn: "Test", etternavn: "Person" }],
  emne_liste: [{ id: 200, navn: "Næringspolitikk", er_hovedemne: true }],
  saksordfoerer_liste: [],
};

// Sak with AI in emne_liste but not in title.
const SAK_AI_EMNE = {
  id: 100002,
  tittel: "Statsbudsjettet 2025",
  korttittel: null,
  dokumentgruppe: 2,
  type: 2,
  status: 4,
  emne_liste: [
    { id: 300, navn: "Maskinlæring og digitalisering", er_hovedemne: true },
    { id: 301, navn: "Offentlig forvaltning", er_hovedemne: false },
  ],
  komite: { id: 9, navn: "Finanskomiteen" },
};

// Sak with no AI signal at all.
const SAK_NO_AI = {
  id: 100003,
  tittel: "Endringer i vegtrafikkloven",
  korttittel: "Vegtrafikkloven",
  dokumentgruppe: 1,
  type: 1,
  status: 4,
  emne_liste: [{ id: 400, navn: "Samferdsel", er_hovedemne: true }],
  komite: { id: 11, navn: "Transport- og kommunikasjonskomiteen" },
};

describe("buildSakRow", () => {
  it("flags has_ai_in_title when keyword in tittel", () => {
    const row = buildSakRow(SAK_AI_TITLE, CTX);
    expect(row).not.toBeNull();
    expect(row!.has_ai_in_title).toBe(true);
    expect(row!.has_ai_in_emner).toBe(false);
    expect(row!.matched_keywords_title).toContain("kunstig intelligens");
  });

  it("flags has_ai_in_emner when keyword only in emne_liste", () => {
    const row = buildSakRow(SAK_AI_EMNE, CTX);
    expect(row).not.toBeNull();
    expect(row!.has_ai_in_title).toBe(false);
    expect(row!.has_ai_in_emner).toBe(true);
    expect(row!.matched_keywords_emner).toContain("maskinlæring");
  });

  it("flags neither when no AI keyword present", () => {
    const row = buildSakRow(SAK_NO_AI, CTX);
    expect(row).not.toBeNull();
    expect(row!.has_ai_in_title).toBe(false);
    expect(row!.has_ai_in_emner).toBe(false);
    expect(row!.matched_keywords_title).toEqual([]);
    expect(row!.matched_keywords_emner).toEqual([]);
  });

  it("flattens komite to id + navn", () => {
    const row = buildSakRow(SAK_AI_TITLE, CTX);
    expect(row!.komite_id).toBe(7);
    expect(row!.komite_navn).toBe("Næringskomiteen");
  });

  it("stamps sesjon_id from ctx", () => {
    const row = buildSakRow(SAK_AI_TITLE, CTX);
    expect(row!.sesjon_id).toBe("2024-2025");
  });

  it("strips time portion from sist_oppdatert_dato", () => {
    const row = buildSakRow(SAK_AI_TITLE, CTX);
    expect(row!.sist_oppdatert_dato).toBe("2024-12-15");
  });

  it("returns null when sak.id is missing", () => {
    expect(buildSakRow({ tittel: "no id" }, CTX)).toBeNull();
  });

  it("returns null when tittel is empty", () => {
    expect(buildSakRow({ id: 99, tittel: "" }, CTX)).toBeNull();
  });

  it("preserves raw upstream object in raw_jsonb", () => {
    const row = buildSakRow(SAK_AI_TITLE, CTX);
    expect(row!.raw_jsonb).toEqual(SAK_AI_TITLE);
  });

  it("handles missing emne_liste gracefully", () => {
    const row = buildSakRow({ id: 1, tittel: "Test" }, CTX);
    expect(row).not.toBeNull();
    expect(row!.has_ai_in_emner).toBe(false);
    expect(row!.emne_liste).toBeNull();
  });

  it("walks underemne_liste when present", () => {
    const sak = {
      id: 12345,
      tittel: "Test",
      emne_liste: [
        {
          id: 1,
          navn: "Generell politikk",
          underemne_liste: [{ id: 11, navn: "Kunstig intelligens og roboter" }],
        },
      ],
    };
    const row = buildSakRow(sak, CTX);
    expect(row!.has_ai_in_emner).toBe(true);
  });
});

// Realistic-shape vedtak with HTML and AI keyword.
const VEDTAK_AI_TEKST = {
  id: 500001,
  sak_id: 100001,
  stortingsvedtak_dato_tid: "2024-12-20T13:45:00",
  stortingsvedtak_lenke_url: "https://www.stortinget.no/vedtak/500001",
  sak_lenke_url: "https://www.stortinget.no/sak/100001",
  stortingsvedtak_nummer: 42,
  stortingsvedtak_tekst:
    "<div class='strtngt_vedtak'><p>Stortinget ber regjeringen om å fremme forslag om en nasjonal strategi for <strong>kunstig intelligens</strong> innen 2026.</p></div>",
  stortingsvedtak_tittel: "Vedtak 42 (2024-2025)",
  stortingsvedtak_type: { id: "ANMOD", navn: "Anmodning" },
};

describe("buildVedtakRow", () => {
  it("strips HTML before matching", () => {
    const row = buildVedtakRow(VEDTAK_AI_TEKST, CTX);
    expect(row).not.toBeNull();
    expect(row!.has_ai_in_text).toBe(true);
    expect(row!.matched_keywords).toContain("kunstig intelligens");
    // Raw tekst is preserved with HTML intact.
    expect(row!.tekst).toContain("<strong>");
  });

  it("captures type_id verbatim string", () => {
    const row = buildVedtakRow(VEDTAK_AI_TEKST, CTX);
    expect(row!.type_id).toBe("ANMOD");
    expect(row!.type_navn).toBe("Anmodning");
  });

  it("returns null when vedtak.id missing", () => {
    expect(buildVedtakRow({ sak_id: 1, stortingsvedtak_tekst: "" }, CTX)).toBeNull();
  });

  it("preserves links to sak and vedtak detail pages", () => {
    const row = buildVedtakRow(VEDTAK_AI_TEKST, CTX);
    expect(row!.sak_lenke_url).toBe("https://www.stortinget.no/sak/100001");
    expect(row!.vedtak_lenke_url).toBe("https://www.stortinget.no/vedtak/500001");
  });
});

describe("stripHtml", () => {
  it("removes tags and collapses whitespace", () => {
    expect(stripHtml("<p>hello <strong>world</strong></p>")).toBe("hello world");
  });

  it("decodes basic named entities", () => {
    expect(stripHtml("a&nbsp;b&amp;c &lt;x&gt; &quot;y&quot; &#39;z&#39;")).toBe(
      'a b&c <x> "y" \'z\'',
    );
  });

  it("returns empty string on null/undefined/non-string", () => {
    expect(stripHtml(null as unknown as string)).toBe("");
    expect(stripHtml(undefined as unknown as string)).toBe("");
    expect(stripHtml(123 as unknown as string)).toBe("");
  });
});

describe("currentSessionId", () => {
  it("returns same-year session in October", () => {
    expect(currentSessionId(new Date("2024-10-05T00:00:00Z"))).toBe("2024-2025");
  });

  it("returns prior-year session before October", () => {
    expect(currentSessionId(new Date("2025-05-15T00:00:00Z"))).toBe("2024-2025");
  });

  it("returns prior-year session in September boundary", () => {
    expect(currentSessionId(new Date("2025-09-30T00:00:00Z"))).toBe("2024-2025");
  });

  it("flips to new session on October 1", () => {
    expect(currentSessionId(new Date("2025-10-01T00:00:00Z"))).toBe("2025-2026");
  });
});

describe("enumerateSessions", () => {
  it("walks backward when from > to", () => {
    expect(enumerateSessions("2025-2026", "2023-2024")).toEqual([
      "2025-2026",
      "2024-2025",
      "2023-2024",
    ]);
  });

  it("walks forward when from < to", () => {
    expect(enumerateSessions("2018-2019", "2020-2021")).toEqual([
      "2018-2019",
      "2019-2020",
      "2020-2021",
    ]);
  });

  it("returns single session when from === to", () => {
    expect(enumerateSessions("2024-2025", "2024-2025")).toEqual(["2024-2025"]);
  });

  it("throws on malformed input", () => {
    expect(() => enumerateSessions("bad", "2024-2025")).toThrow();
  });
});

// data.stortinget.no actually returns Microsoft JSON dates of the shape
// "/Date(ms+offset)/" — discovered when the first backfill hit
// `invalid input syntax for type date: "/Date(1715"`. These tests pin
// that the helpers normalize both that format and ISO 8601 so we don't
// silently regress to a slice(0,10) implementation.
describe("parseStortingDate", () => {
  it("parses Microsoft /Date(ms+offset)/ format", () => {
    // 2024-12-15 00:00:00 UTC = 1734220800000 ms
    expect(parseStortingDate("/Date(1734220800000+0200)/")).toBe("2024-12-15");
  });

  it("parses Microsoft /Date(ms)/ without offset", () => {
    expect(parseStortingDate("/Date(1734220800000)/")).toBe("2024-12-15");
  });

  it("parses ISO 8601 with time portion", () => {
    expect(parseStortingDate("2024-12-15T13:45:00")).toBe("2024-12-15");
  });

  it("parses bare ISO date", () => {
    expect(parseStortingDate("2024-12-15")).toBe("2024-12-15");
  });

  it("returns null on null/undefined/empty", () => {
    expect(parseStortingDate(null)).toBeNull();
    expect(parseStortingDate(undefined)).toBeNull();
    expect(parseStortingDate("")).toBeNull();
  });

  it("returns null on unparseable garbage", () => {
    expect(parseStortingDate("not-a-date")).toBeNull();
    expect(parseStortingDate("/Date(notanumber)/")).toBeNull();
  });
});

describe("parseStortingTimestamp", () => {
  it("parses /Date(ms+offset)/ into full ISO timestamp", () => {
    expect(parseStortingTimestamp("/Date(1734220800000+0200)/")).toBe(
      "2024-12-15T00:00:00.000Z",
    );
  });

  it("passes ISO through verbatim", () => {
    expect(parseStortingTimestamp("2024-12-15T13:45:00")).toBe(
      "2024-12-15T13:45:00",
    );
  });

  it("returns null on garbage", () => {
    expect(parseStortingTimestamp("not-a-timestamp")).toBeNull();
  });
});

// Regression: a sak whose sist_oppdatert_dato uses the MS format must
// normalize to YYYY-MM-DD so Postgres accepts it. Before the fix this
// landed as "/Date(173" — Postgres rejected the whole batch.
describe("buildSakRow with MS date format", () => {
  it("normalizes MS /Date(ms)/ in sist_oppdatert_dato", () => {
    const row = buildSakRow(
      { ...SAK_AI_TITLE, sist_oppdatert_dato: "/Date(1734220800000+0200)/" },
      CTX,
    );
    expect(row!.sist_oppdatert_dato).toBe("2024-12-15");
  });
});

describe("buildVedtakRow with MS date format", () => {
  it("normalizes MS /Date(ms)/ in stortingsvedtak_dato_tid", () => {
    const row = buildVedtakRow(
      { ...VEDTAK_AI_TEKST, stortingsvedtak_dato_tid: "/Date(1734702300000+0100)/" },
      CTX,
    );
    expect(row!.dato_tid).toBe("2024-12-20T13:45:00.000Z");
  });
});
