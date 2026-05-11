// Data cutoff for /jobbmarked charts.
//
// NAV's public API only serves full posting detail (description) for ACTIVE
// ads. Once an ad goes INACTIVE, the detail endpoint either 404s or returns
// only {uuid, status, sistEndret} — no description. The keyword matcher
// needs description text to be reliable (title alone catches ~0.2% AI; full
// text catches ~2%).
//
// Because kibarometer started ingesting live data in early May 2026, almost
// every NAV posting predating that came in via backfillNav walking NAV's
// archive feed — every one of those was INACTIVE at ingest, so it never had
// a chance to be enriched. Result: pre-April-2026 rows are tagged on title
// alone and undercount AI by roughly 10x.
//
// Per-week description-coverage measured 2026-05-11:
//   2025-11 to 2026-04-06: 0.7 - 10.6%   (too unreliable to publish)
//   2026-04-13:            26.9%         (first usable week)
//   2026-04-20 onward:     46.3% - 57.4% (good)
//
// Choosing 2026-04-13 as the chart minimum: first week where coverage
// crosses 25%, which is the lowest threshold where we trust the
// classifier verdict to be representative of the underlying postings.
//
// This is a stopgap. Real fix: keep accumulating live data forward.
// Reassess this threshold quarterly — once we have a year of reliable
// data, we can drop the cutoff or push it later.
export const JOBBMARKED_DATA_CUTOFF = "2026-04-13";
