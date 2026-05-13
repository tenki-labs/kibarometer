// Data cutoff for /offentlig charts.
//
// Both pillar sources have a natural floor:
//   - Stortinget: data.stortinget.no goes much further back, but the
//     /offentlig pillar's backfill walks sessions back to 2018-2019 (the
//     first session that fully contains data from 2019-01-01 onwards).
//     Pre-2019 saker would render only if someone manually backfills
//     them, and we'd rather render them on a separate "historical
//     context" view than leak them into the current dashboard.
//   - Doffin (when it lands): the same 2019-01-01 floor is documented in
//     the pillar plan — Norway's National AI Strategy launched January
//     2020, so a year of pre-baseline data anchors the YoY comparison.
//
// Enforced page-side by passing &sist_oppdatert_dato=gte. / &computed_for=gte.
// to PostgREST. The snapshot tables themselves can hold older rows
// (refresh functions don't filter — they just compute monthly buckets
// for whatever's in storting_saker). If pre-2019 rows are ever needed,
// drop the page filter without touching the SQL.
export const OFFENTLIG_DATA_CUTOFF = "2019-01-01";

export const OFFENTLIG_DATA_CUTOFF_MS = new Date(
  OFFENTLIG_DATA_CUTOFF + "T00:00:00Z",
).getTime();
