// lib/admin/legacy/brreg-stream.test.ts
// Tests for parseJsonArrayObjects — the streaming JSON-array parser used by
// bootstrapBrreg() to walk brreg's gzipped bulk dump without loading the
// ~1.5 GB decompressed payload into memory.
//
// Covers:
//   - Single-chunk happy path
//   - Multi-chunk delivery (object split across chunk boundaries)
//   - Quoted braces and escaped quotes don't fool the depth counter
//   - Whitespace + newlines + commas between elements are tolerated
//   - Empty array yields nothing without crashing
//   - Nested objects inside an array element parse correctly

import { describe, expect, it } from "vitest";
import { parseJsonArrayObjects } from "./brreg.js";

function bytesOf(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

// Yields each input chunk as a Uint8Array — simulates a streamed body.
async function* asByteStream(...chunks: string[]): AsyncIterable<Uint8Array> {
  for (const c of chunks) yield bytesOf(c);
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

describe("parseJsonArrayObjects", () => {
  it("parses a single-chunk array of two objects", async () => {
    const stream = asByteStream(`[{"a":1},{"b":"two"}]`);
    const out = await collect(parseJsonArrayObjects(stream));
    expect(out).toEqual([{ a: 1 }, { b: "two" }]);
  });

  it("parses an empty array", async () => {
    const stream = asByteStream(`[]`);
    const out = await collect(parseJsonArrayObjects(stream));
    expect(out).toEqual([]);
  });

  it("survives objects split across chunk boundaries", async () => {
    // Split mid-object three times to make sure buffering works
    const stream = asByteStream(
      `[{"a"`,
      `:1,"navn":"Test`,
      ` AS"},{"b":2`,
      `}]`,
    );
    const out = await collect(parseJsonArrayObjects(stream));
    expect(out).toEqual([
      { a: 1, navn: "Test AS" },
      { b: 2 },
    ]);
  });

  it("handles braces inside quoted strings without false depth changes", async () => {
    const stream = asByteStream(
      `[{"navn":"Acme {AI} AS","aktivitet":["{not-an-object}"]},{"x":1}]`,
    );
    const out = await collect(parseJsonArrayObjects(stream));
    expect(out).toEqual([
      { navn: "Acme {AI} AS", aktivitet: ["{not-an-object}"] },
      { x: 1 },
    ]);
  });

  it("handles escaped quotes in strings", async () => {
    const stream = asByteStream(
      `[{"navn":"Quote \\"Inside\\" AS","x":1},{"y":2}]`,
    );
    const out = await collect(parseJsonArrayObjects(stream));
    expect(out[0].navn).toBe('Quote "Inside" AS');
    expect(out).toHaveLength(2);
  });

  it("tolerates pretty-printed whitespace between elements", async () => {
    const stream = asByteStream(
      `[\n  {\n    "a": 1\n  },\n  {\n    "b": 2\n  }\n]`,
    );
    const out = await collect(parseJsonArrayObjects(stream));
    expect(out).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("parses nested objects inside an element", async () => {
    const stream = asByteStream(
      `[{"organisasjonsform":{"kode":"AS","beskrivelse":"Aksjeselskap"},"navn":"Foo"}]`,
    );
    const out = await collect(parseJsonArrayObjects(stream));
    expect(out).toEqual([
      {
        organisasjonsform: { kode: "AS", beskrivelse: "Aksjeselskap" },
        navn: "Foo",
      },
    ]);
  });

  it("handles a chunk that ends exactly at an object boundary", async () => {
    // Tests the edge case where consumeUpTo lands exactly at the end of
    // a closing brace — the next chunk starts with whitespace/comma.
    const stream = asByteStream(`[{"a":1}`, `,{"b":2}]`);
    const out = await collect(parseJsonArrayObjects(stream));
    expect(out).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("walks a brreg-shaped fixture (entity envelope)", async () => {
    // Trimmed but realistic brreg entity. Validates that the parser
    // handles nested objects, mixed types, arrays, and Norwegian chars.
    const fixture = JSON.stringify([
      {
        organisasjonsnummer: "934111111",
        navn: "Nordic Solutions AS",
        organisasjonsform: { kode: "AS", beskrivelse: "Aksjeselskap" },
        registreringsdatoEnhetsregisteret: "2025-03-12",
        naeringskode1: { kode: "62.010", beskrivelse: "Programmeringstjenester" },
        forretningsadresse: { kommunenummer: "0301", postnummer: "0150", poststed: "OSLO" },
        aktivitet: ["Programvareutvikling for konsulentmarkedet."],
        vedtektsfestetFormaal: ["Utvikling av kunstig intelligens-baserte løsninger."],
        kapital: { type: "Aksjekapital", valuta: "NOK", belop: 100000 },
        konkurs: false,
      },
      {
        organisasjonsnummer: "934222222",
        navn: "Bjørn AI Studio",
        organisasjonsform: { kode: "ENK", beskrivelse: "Enkeltpersonforetak" },
        registreringsdatoEnhetsregisteret: "2025-04-01",
      },
    ]);
    // Split fixture into 5 chunks of varied size to exercise boundary code
    const len = fixture.length;
    const cuts = [Math.floor(len / 7), Math.floor(len / 3), Math.floor(len / 2), Math.floor((len * 3) / 4)];
    const chunks: string[] = [];
    let prev = 0;
    for (const c of cuts) {
      chunks.push(fixture.slice(prev, c));
      prev = c;
    }
    chunks.push(fixture.slice(prev));
    const stream = asByteStream(...chunks);
    const out = await collect(parseJsonArrayObjects(stream));
    expect(out).toHaveLength(2);
    expect(out[0].organisasjonsnummer).toBe("934111111");
    expect(out[0].kapital.belop).toBe(100000);
    expect(out[0].vedtektsfestetFormaal[0]).toContain("kunstig intelligens");
    expect(out[1].organisasjonsform.kode).toBe("ENK");
    expect(out[1].navn).toBe("Bjørn AI Studio");
  });
});
