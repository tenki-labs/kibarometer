// lib/admin/legacy/keyset-paginate.js
//
// Keyset (seek) pagination over a PostgREST collection ordered ascending by
// a UNIQUE, NOT-NULL column (a primary key).
//
// WHY THIS EXISTS — the four retag reprocessors (NAV, media, brreg,
// storting) used to paginate with `&order=<pk>.asc&limit=N&offset=K`,
// walking the whole table 1000 rows at a time. OFFSET makes Postgres
// produce the full ordered result and discard the first K rows on EVERY
// page, so cumulative cost grows with depth. Near the end of a large table
// the planner abandons the index for a seqscan + sort that carries the wide
// text columns, spills to disk, and crosses `statement_timeout` — PostgREST
// surfaces it as `57014 canceling statement due to statement timeout` → a
// 500. brreg_companies hit it first at ~92k rows: the page at offset=91000
// timed out and failed the whole reprocess_brreg_keywords run.
//
// Keyset pagination instead seeks past the last-seen key on every page
// (`<pk> > cursor order by <pk> asc limit N`): a single index range scan of
// exactly N rows, constant cost regardless of depth. It never approaches
// the timeout no matter how large the table grows.
//
// REQUIREMENT: `orderCol` MUST be unique and NOT NULL. A tie would let the
// `gt.` seek skip every row sharing the cursor's value — silently dropping
// rows from the retag and miscounting AI relevance. All four call sites pass
// their table's primary key (orgnr / id / sak_id / vedtak_id), which
// satisfies this; the migrations are the source of truth.
//
// @param {Function} sb   PostgREST client (lib/admin/sb.ts sbFetch shape).
// @param {Object}   opts
// @param {string}   opts.path     collection path WITH select/filters but
//                                  NO order/limit/offset, e.g.
//                                  `/brreg_companies?select=orgnr,navn` or
//                                  `/media_articles?deleted_at=is.null&select=id,headline`.
// @param {string}   opts.orderCol unique PK column to order + seek by.
// @param {number}   opts.pageSize rows per page.
// @param {Function} onPage  async (rows) => boolean|void. Invoked once per
//                           non-empty page. Return `true` to stop early
//                           (e.g. a user STOP PATCH tripped) — the loop
//                           returns without fetching the next page.
export async function keysetPaginate(sb, { path, orderCol, pageSize }, onPage) {
  let cursor = null;
  for (;;) {
    const sep = path.includes("?") ? "&" : "?";
    const seek =
      cursor === null ? "" : `&${orderCol}=gt.${encodeURIComponent(cursor)}`;
    const rows = await sb(
      `${path}${sep}order=${orderCol}.asc&limit=${pageSize}${seek}`,
      { service: true },
    );
    if (!Array.isArray(rows) || rows.length === 0) return;

    const stop = await onPage(rows);
    if (stop === true) return;

    // A short page means we've reached the end — no need to probe further.
    if (rows.length < pageSize) return;

    const last = rows[rows.length - 1][orderCol];
    if (last === undefined || last === null) {
      throw new Error(
        `keysetPaginate: order column "${orderCol}" missing/null in last row — ` +
          `cannot advance cursor safely (would loop forever). Check the select clause.`,
      );
    }
    cursor = last;
  }
}
