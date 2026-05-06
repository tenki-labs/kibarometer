import { describe, it, expect } from "vitest";
import { parseTier2, STANCE_VALUES, clampUnit } from "./llm-media-parse";

describe("parseTier2", () => {
  it("parses a complete response", () => {
    const out = parseTier2(
      JSON.stringify({
        categories: [
          { slug: "policy-regulation", confidence: 0.9 },
          { slug: "tools-vendors", confidence: 0.4 },
        ],
        stance: "alarmed",
        intensity: 0.7,
        rationale: "EU AI Act framed som trussel.",
      }),
    );
    expect(out?.categories).toHaveLength(2);
    expect(out?.categories[0]).toEqual({
      slug: "policy-regulation",
      confidence: 0.9,
    });
    expect(out?.stance).toBe("alarmed");
    expect(out?.intensity).toBe(0.7);
    expect(out?.rationale).toMatch(/EU AI Act/);
  });

  it("handles ```json fences", () => {
    const out = parseTier2(
      '```json\n{"categories":[],"stance":"neutral-explainer","intensity":0.2,"rationale":"x"}\n```',
    );
    expect(out?.stance).toBe("neutral-explainer");
    expect(out?.categories).toEqual([]);
  });

  it("returns null on garbage", () => {
    expect(parseTier2("nope")).toBeNull();
    expect(parseTier2("")).toBeNull();
  });

  it("coerces missing fields to safe defaults", () => {
    const out = parseTier2('{"categories": []}');
    expect(out?.stance).toBeNull();
    expect(out?.intensity).toBeNull();
    expect(out?.rationale).toBe("");
  });

  it("falls back to confidence=0.5 when missing or non-numeric", () => {
    const out = parseTier2(
      '{"categories":[{"slug":"a"},{"slug":"b","confidence":"high"}],"stance":"critical","intensity":0.5,"rationale":""}',
    );
    expect(out?.categories[0]?.confidence).toBe(0.5);
    expect(out?.categories[1]?.confidence).toBe(0.5);
  });

  it("drops malformed category entries", () => {
    const out = parseTier2(
      '{"categories":[{"slug":"ok","confidence":0.8},{"foo":"bar"},"bare"],"stance":"critical","intensity":0.5,"rationale":""}',
    );
    expect(out?.categories).toEqual([{ slug: "ok", confidence: 0.8 }]);
  });

  it("preserves an unknown stance string for the orchestrator to filter", () => {
    // parseTier2 doesn't validate against the enum — orchestrator does that.
    const out = parseTier2(
      '{"categories":[],"stance":"euphoric","intensity":0.5,"rationale":""}',
    );
    expect(out?.stance).toBe("euphoric");
  });
});

describe("clampUnit", () => {
  it("clamps below zero to 0", () => {
    expect(clampUnit(-0.5)).toBe(0);
  });
  it("clamps above one to 1", () => {
    expect(clampUnit(1.7)).toBe(1);
  });
  it("returns 0.5 for non-numbers", () => {
    expect(clampUnit("0.8")).toBe(0.5);
    expect(clampUnit(NaN)).toBe(0.5);
    expect(clampUnit(null)).toBe(0.5);
  });
  it("passes through valid values", () => {
    expect(clampUnit(0.42)).toBe(0.42);
  });
});

describe("STANCE_VALUES", () => {
  it("matches the 6-value enum from migration 0029", () => {
    expect([...STANCE_VALUES].sort()).toEqual(
      [
        "alarmed",
        "critical",
        "enthusiastic",
        "neutral-explainer",
        "personal-story",
        "policy-debate",
      ].sort(),
    );
  });
});
