// Tests for keysetPaginate — the seek-pagination helper that replaced the
// deep-OFFSET loops in the four retag reprocessors (NAV, media, brreg,
// storting). The property that matters most for data legitimacy: every row
// is visited exactly once, in order, with no gaps or duplicates — a
// pagination bug here would silently miscount AI relevance.
import { describe, it, expect } from "vitest";
import { keysetPaginate } from "./keyset-paginate.js";

// A fake PostgREST `sb` over an in-memory, pre-sorted dataset. Parses the
// keyset query (limit + <col>=gt.X) and returns the matching slice — exactly
// what `... where col > X order by col asc limit N` would return.
function fakeSb(allRows: Record<string, unknown>[], orderCol: string) {
  const calls: string[] = [];
  const numeric = typeof allRows[0]?.[orderCol] === "number";
  const sb = async (url: string) => {
    calls.push(url);
    const qs = new URLSearchParams(url.split("?")[1] ?? "");
    const limit = Number(qs.get("limit"));
    const raw = qs.get(orderCol); // "gt.<cursor>" or null on the first page
    const cursor = raw ? raw.replace(/^gt\./, "") : null;
    let rows = allRows;
    if (cursor !== null) {
      rows = rows.filter((r) =>
        numeric
          ? (r[orderCol] as number) > Number(cursor)
          : String(r[orderCol]) > cursor,
      );
    }
    return rows.slice(0, limit);
  };
  return { sb, calls };
}

// 9-digit, equal-length, ascending string keys (mirrors brreg orgnr, where
// lexicographic order == numeric order).
const mk = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    orgnr: String(100000000 + i),
    navn: `c${i}`,
  }));

describe("keysetPaginate", () => {
  const orderCol = "orgnr";

  it("visits every row exactly once, in order, across pages", async () => {
    const data = mk(2500);
    const { sb } = fakeSb(data, orderCol);
    const seen: string[] = [];
    await keysetPaginate(
      sb,
      { path: `/t?select=orgnr,navn`, orderCol, pageSize: 1000 },
      async (rows) => {
        for (const r of rows) seen.push(r.orgnr as string);
      },
    );
    expect(seen).toEqual(data.map((r) => r.orgnr));
    expect(new Set(seen).size).toBe(2500);
  });

  it("never uses offset=", async () => {
    const { sb, calls } = fakeSb(mk(2500), orderCol);
    await keysetPaginate(
      sb,
      { path: `/t?select=orgnr`, orderCol, pageSize: 1000 },
      async () => {},
    );
    expect(calls.every((u) => !u.includes("offset="))).toBe(true);
  });

  it("first page has no seek; later pages seek gt.<last-of-prev>", async () => {
    const data = mk(2500);
    const { sb, calls } = fakeSb(data, orderCol);
    await keysetPaginate(
      sb,
      { path: `/t?select=orgnr`, orderCol, pageSize: 1000 },
      async () => {},
    );
    expect(calls[0]).not.toContain("orgnr=gt.");
    expect(calls[1]).toContain(`orgnr=gt.${data[999].orgnr}`);
    expect(calls[2]).toContain(`orgnr=gt.${data[1999].orgnr}`);
  });

  it("always orders asc by the key and carries the page limit", async () => {
    const { sb, calls } = fakeSb(mk(1500), orderCol);
    await keysetPaginate(
      sb,
      { path: `/t?select=orgnr`, orderCol, pageSize: 1000 },
      async () => {},
    );
    for (const u of calls) {
      expect(u).toContain("order=orgnr.asc");
      expect(u).toContain("limit=1000");
    }
  });

  it("stops on a short final page without an extra fetch", async () => {
    const { sb, calls } = fakeSb(mk(1500), orderCol);
    let pages = 0;
    await keysetPaginate(
      sb,
      { path: `/t?select=orgnr`, orderCol, pageSize: 1000 },
      async () => {
        pages++;
      },
    );
    expect(pages).toBe(2); // 1000 + 500
    expect(calls.length).toBe(2); // no third fetch
  });

  it("stops on the empty probe when total is an exact multiple of pageSize", async () => {
    const { sb, calls } = fakeSb(mk(2000), orderCol);
    let pages = 0;
    await keysetPaginate(
      sb,
      { path: `/t?select=orgnr`, orderCol, pageSize: 1000 },
      async () => {
        pages++;
      },
    );
    expect(pages).toBe(2);
    expect(calls.length).toBe(3); // two full pages + one empty probe
  });

  it("handles an empty table: one fetch, onPage never called", async () => {
    const { sb, calls } = fakeSb([], orderCol);
    let pages = 0;
    await keysetPaginate(
      sb,
      { path: `/t?select=orgnr`, orderCol, pageSize: 1000 },
      async () => {
        pages++;
      },
    );
    expect(pages).toBe(0);
    expect(calls.length).toBe(1);
  });

  it("stops early when onPage returns true (user STOP)", async () => {
    const { sb, calls } = fakeSb(mk(5000), orderCol);
    let pages = 0;
    await keysetPaginate(
      sb,
      { path: `/t?select=orgnr`, orderCol, pageSize: 1000 },
      async () => {
        pages++;
        return true;
      },
    );
    expect(pages).toBe(1);
    expect(calls.length).toBe(1);
  });

  it("supports bigint primary keys (numeric cursor, no quotes)", async () => {
    const data = Array.from({ length: 1500 }, (_, i) => ({
      sak_id: i + 1,
      tittel: `s${i}`,
    }));
    const { sb, calls } = fakeSb(data, "sak_id");
    const seen: number[] = [];
    await keysetPaginate(
      sb,
      { path: `/storting_saker?select=sak_id,tittel`, orderCol: "sak_id", pageSize: 1000 },
      async (rows) => {
        for (const r of rows) seen.push(r.sak_id as number);
      },
    );
    expect(seen).toEqual(data.map((r) => r.sak_id));
    expect(calls[1]).toContain("sak_id=gt.1000"); // numeric, unquoted
  });

  it("throws if the order column is missing from a returned row (no infinite loop)", async () => {
    // A full page (== pageSize) whose rows lack orderCol would otherwise
    // leave the cursor stuck and loop forever. Guard turns it into a throw.
    const sb = async () =>
      Array.from({ length: 1000 }, (_, i) => ({ navn: `x${i}` }));
    await expect(
      keysetPaginate(
        sb as unknown as (u: string, o?: unknown) => Promise<unknown[]>,
        { path: `/t?select=navn`, orderCol: "orgnr", pageSize: 1000 },
        async () => {},
      ),
    ).rejects.toThrow(/order column "orgnr"/);
  });
});
