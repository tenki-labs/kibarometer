import { describe, it, expect } from "vitest";
import { parseTier1, validatePhrases } from "./llm-media-parse";

describe("parseTier1", () => {
  it("parses raw JSON", () => {
    const out = parseTier1(
      '{"ai_relevant": true, "phrases": [{"text": "ChatGPT"}]}',
    );
    expect(out).toEqual({
      ai_relevant: true,
      phrases: [{ text: "ChatGPT" }],
    });
  });

  it("strips ```json fences", () => {
    const out = parseTier1(
      '```json\n{"ai_relevant": false, "phrases": []}\n```',
    );
    expect(out).toEqual({ ai_relevant: false, phrases: [] });
  });

  it("extracts the first object when prose surrounds it", () => {
    const out = parseTier1(
      'Sure, here you go: {"ai_relevant": true, "phrases": [{"text": "AI"}]} hope that helps.',
    );
    expect(out?.ai_relevant).toBe(true);
    expect(out?.phrases).toEqual([{ text: "AI" }]);
  });

  it("returns null on garbage", () => {
    expect(parseTier1("nope nope nope")).toBeNull();
    expect(parseTier1("")).toBeNull();
  });

  it("coerces missing phrases to []", () => {
    expect(parseTier1('{"ai_relevant": true}')).toEqual({
      ai_relevant: true,
      phrases: [],
    });
  });

  it("drops phrase entries without a string `text`", () => {
    const out = parseTier1(
      '{"ai_relevant": true, "phrases": [{"text": "ok"}, {"foo": 1}, "bare"]}',
    );
    expect(out?.phrases).toEqual([{ text: "ok" }]);
  });
});

describe("validatePhrases", () => {
  it("keeps phrases that appear verbatim in the headline", () => {
    const out = validatePhrases(
      [{ text: "ChatGPT" }, { text: "kunstig intelligens" }],
      "Datatilsynet advarer mot ChatGPT i kommunal saksbehandling",
    );
    expect(out).toEqual([{ text: "ChatGPT" }]);
  });

  it("matches case-insensitively", () => {
    const out = validatePhrases(
      [{ text: "openai" }],
      "OpenAI lanserer ny modell",
    );
    expect(out).toEqual([{ text: "openai" }]);
  });

  it("dedupes by lowercased text", () => {
    const out = validatePhrases(
      [{ text: "ChatGPT" }, { text: "chatgpt" }, { text: "CHATGPT" }],
      "ChatGPT er overalt",
    );
    expect(out).toHaveLength(1);
  });

  it("drops phrases longer than the ceiling", () => {
    const long = "x".repeat(100);
    const headline = `OK and ${long}`;
    const out = validatePhrases(
      [{ text: long }, { text: "OK" }],
      headline,
    );
    expect(out.map((p) => p.text)).toEqual(["OK"]);
  });

  it("drops invented phrases (verbatim filter)", () => {
    const out = validatePhrases(
      [{ text: "transformer architecture" }],
      "AI bedrer kundeservice",
    );
    expect(out).toEqual([]);
  });
});
