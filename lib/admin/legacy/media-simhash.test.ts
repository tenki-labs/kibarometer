import { describe, it, expect } from "vitest";
import { simhash, hamming, isSimilar, fnv1a64, tokenize, toPgBigint } from "./media-simhash.js";

const MAX_U64 = BigInt("0xffffffffffffffff");
const MIN_I64 = -(BigInt(2) ** BigInt(63));
const MAX_I64 = BigInt(2) ** BigInt(63);

describe("fnv1a64", () => {
  it("is deterministic and 64-bit", () => {
    const h = fnv1a64("hello");
    expect(typeof h).toBe("bigint");
    expect(h).toBe(fnv1a64("hello"));
    expect(h <= MAX_U64).toBe(true);
  });

  it("differs for distinct inputs", () => {
    expect(fnv1a64("hello")).not.toBe(fnv1a64("world"));
    expect(fnv1a64("KI")).not.toBe(fnv1a64("AI"));
  });
});

describe("tokenize", () => {
  it("strips punctuation and lowercases (unigrams + 2-shingles + char 4-grams)", () => {
    const tokens = tokenize("Hello, World!");
    expect(tokens).toContain("hello");
    expect(tokens).toContain("world");
    expect(tokens).toContain("hello world");
    expect(tokens).toContain("hell"); // char 4-gram
  });

  it("keeps Norwegian characters", () => {
    const tokens = tokenize("Maskinlæring og kunstig intelligens");
    expect(tokens).toContain("maskinlæring");
    expect(tokens).toContain("kunstig intelligens");
  });

  it("returns [] for empty input", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize(null as any)).toEqual([]);
  });
});

describe("simhash", () => {
  it("returns a 64-bit signed BigInt", () => {
    const h = simhash("Norwegian AI policy update");
    expect(typeof h).toBe("bigint");
    expect(h >= MIN_I64).toBe(true);
    expect(h < MAX_I64).toBe(true);
  });

  it("identical input produces identical hash", () => {
    const a = simhash("Regjeringen vil innføre KI-strategi for offentlig sektor");
    const b = simhash("Regjeringen vil innføre KI-strategi for offentlig sektor");
    expect(a).toBe(b);
  });

  it("near-identical NTB rewrites land within the Hamming threshold", () => {
    // Plausible NTB-style rewrite: same lede, minor word swaps. Two outlets
    // running the same wire story should stay within the default similarity
    // threshold (6 bits — see media-simhash.js comment for rationale).
    const a = simhash(
      "Regjeringen presenterer ny strategi for kunstig intelligens i offentlig sektor. " +
      "Statsråden ønsker raskere innføring av KI-verktøy i kommunene og en samordnet " +
      "satsing på kompetanse og infrastruktur."
    );
    const b = simhash(
      "Regjeringen legger fram ny strategi for kunstig intelligens i offentlig sektor. " +
      "Ministeren ønsker raskere innføring av KI-verktøy i kommunene og en samordnet " +
      "satsing på kompetanse og infrastruktur."
    );
    expect(hamming(a, b)).toBeLessThanOrEqual(8);
    expect(isSimilar(a, b)).toBe(true);
  });

  it("unrelated articles diverge well past the threshold", () => {
    const a = simhash(
      "Politiet etterforsker brann i bolighus i Bergen. Nabolaget er evakuert " +
      "og brannvesenet jobber med å begrense skadene."
    );
    const b = simhash(
      "OpenAI lanserer ny modell med betydelig bedre resonneringsevne. " +
      "Selskapet sier den er tilgjengelig fra i dag for betalende kunder."
    );
    expect(hamming(a, b)).toBeGreaterThan(15);
    expect(isSimilar(a, b)).toBe(false);
  });

  it("empty input produces zero", () => {
    expect(simhash("")).toBe(BigInt(0));
  });
});

describe("hamming", () => {
  it("accepts BigInt, number, and string inputs", () => {
    expect(hamming(BigInt(0), BigInt(0))).toBe(0);
    expect(hamming(BigInt(0), BigInt(1))).toBe(1);
    expect(hamming(0, 7)).toBe(3);
    expect(hamming("0", "15")).toBe(4);
  });

  it("handles negative signed inputs (Postgres bigint round-trip)", () => {
    // Same bit pattern, expressed as positive and negative signed 64-bit.
    const positive = BigInt("0x7fffffffffffffff");
    const negative = BigInt(-1);
    // 0x7fff... XOR 0xffff... = 0x8000... = 1 bit set.
    expect(hamming(positive, negative)).toBe(1);
  });
});

describe("toPgBigint", () => {
  it("emits a decimal string suitable for JSON bodies", () => {
    expect(toPgBigint(BigInt(0))).toBe("0");
    expect(toPgBigint(BigInt(-1))).toBe("-1");
    expect(toPgBigint(BigInt(123))).toBe("123");
  });

  it("returns null for null/undefined", () => {
    expect(toPgBigint(null)).toBeNull();
    expect(toPgBigint(undefined)).toBeNull();
  });
});
