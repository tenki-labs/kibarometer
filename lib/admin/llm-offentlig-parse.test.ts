// lib/admin/llm-offentlig-parse.test.ts
// Unit tests for llm-offentlig-parse.ts. Tier 1 reuses media's parser so
// the existing llm-media-tier1.test.ts already covers that shape.
// Tier 2 has its own parser (no stance/intensity) — covered here.

import { describe, it, expect } from "vitest";
import {
  parseOffentligTier2,
  clampUnit,
  parseTier1,
  validatePhrases,
} from "./llm-offentlig-parse";

describe("parseOffentligTier2", () => {
  it("parses a complete response", () => {
    const out = parseOffentligTier2(
      JSON.stringify({
        categories: [
          { slug: "ai-regulering", confidence: 0.95 },
          { slug: "ai-etikk-personvern", confidence: 0.7 },
        ],
        rationale: "Lovverk for AI med personverndimensjon.",
      }),
    );
    expect(out?.categories).toHaveLength(2);
    expect(out?.categories[0]).toEqual({
      slug: "ai-regulering",
      confidence: 0.95,
    });
    expect(out?.rationale).toMatch(/personverndimensjon/);
  });

  it("handles ```json fences", () => {
    const out = parseOffentligTier2(
      '```json\n{"categories":[{"slug":"ai-strategi","confidence":0.9}],"rationale":"x"}\n```',
    );
    expect(out?.categories).toEqual([{ slug: "ai-strategi", confidence: 0.9 }]);
  });

  it("handles a leading prose blurb before the JSON", () => {
    // Gemma occasionally outputs a sentence of explanation before the JSON
    // despite the prompt's instructions. The brace-balanced extractor
    // should find the first `{...}` object.
    const out = parseOffentligTier2(
      'Her er resultatet:\n{"categories":[{"slug":"ai-helsepolitikk","confidence":0.85}],"rationale":"Health AI."}',
    );
    expect(out?.categories[0]?.slug).toBe("ai-helsepolitikk");
  });

  it("returns null on garbage / empty", () => {
    expect(parseOffentligTier2("nope")).toBeNull();
    expect(parseOffentligTier2("")).toBeNull();
    expect(parseOffentligTier2("{not valid")).toBeNull();
  });

  it("coerces missing rationale to empty string", () => {
    const out = parseOffentligTier2('{"categories":[]}');
    expect(out?.categories).toEqual([]);
    expect(out?.rationale).toBe("");
  });

  it("falls back to confidence=0.5 when missing or non-numeric", () => {
    const out = parseOffentligTier2(
      '{"categories":[{"slug":"a"},{"slug":"b","confidence":"high"}],"rationale":""}',
    );
    expect(out?.categories[0]?.confidence).toBe(0.5);
    expect(out?.categories[1]?.confidence).toBe(0.5);
  });

  it("drops malformed category entries silently", () => {
    const out = parseOffentligTier2(
      '{"categories":[{"slug":"ok","confidence":0.8},{"foo":"bar"},"bare-string",null],"rationale":""}',
    );
    expect(out?.categories).toEqual([{ slug: "ok", confidence: 0.8 }]);
  });

  it("returns empty categories array when categories key is absent", () => {
    const out = parseOffentligTier2('{"rationale":"no slug applies"}');
    expect(out?.categories).toEqual([]);
    expect(out?.rationale).toBe("no slug applies");
  });

  it("truncates rationale to MAX_RATIONALE_CHARS (400)", () => {
    const long = "a".repeat(800);
    const out = parseOffentligTier2(
      JSON.stringify({ categories: [], rationale: long }),
    );
    expect(out?.rationale.length).toBe(400);
  });

  it("ignores non-string slugs", () => {
    const out = parseOffentligTier2(
      '{"categories":[{"slug":123,"confidence":0.8},{"slug":"ok","confidence":0.7}],"rationale":""}',
    );
    expect(out?.categories).toEqual([{ slug: "ok", confidence: 0.7 }]);
  });
});

describe("clampUnit", () => {
  it("clamps to [0, 1]", () => {
    expect(clampUnit(-0.5)).toBe(0);
    expect(clampUnit(0)).toBe(0);
    expect(clampUnit(0.5)).toBe(0.5);
    expect(clampUnit(1)).toBe(1);
    expect(clampUnit(1.5)).toBe(1);
  });

  it("returns 0.5 for non-finite or non-numeric inputs", () => {
    expect(clampUnit(NaN)).toBe(0.5);
    expect(clampUnit(Infinity)).toBe(0.5);
    expect(clampUnit("0.7")).toBe(0.5);
    expect(clampUnit(null)).toBe(0.5);
    expect(clampUnit(undefined)).toBe(0.5);
  });
});

describe("Tier 1 re-exports (media shape)", () => {
  it("parseTier1 parses {phrases: [{text}]} JSON", () => {
    const out = parseTier1(
      '{"phrases":[{"text":"kunstig intelligens"},{"text":"Datatilsynet"}]}',
    );
    expect(out?.phrases).toHaveLength(2);
    expect(out?.phrases[0]?.text).toBe("kunstig intelligens");
  });

  it("validatePhrases drops phrases that do not occur in the haystack", () => {
    const out = validatePhrases(
      [
        { text: "kunstig intelligens" }, // present
        { text: "AI Act" }, // present
        { text: "GDPR" }, // NOT present
      ],
      "Forslag om kunstig intelligens og EU AI Act i offentlig sektor",
    );
    expect(out.map((p) => p.text)).toEqual([
      "kunstig intelligens",
      "AI Act",
    ]);
  });
});
