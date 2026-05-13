// Data cutoff for /media charts.
//
// Pre-2024 articles do exist in the snapshot tables — old RSS/sitemap
// ingest reaches back as far as 2015 for some outlets. Hiding them on
// the public page (not deleting them) because:
//   1. ChatGPT shipped November 2022; meaningful Norwegian AI coverage
//      starts around 2023. Pre-2023 is mostly translated wire stories.
//   2. The keyword catalog grew substantially in 2025-2026 via Tier 1
//      candidate promotion, and there's no media retag cron — so older
//      articles are tagged against a narrower catalog than today's.
//      Even 2023 rows undercount AI relative to current ingest.
//
// 2024-01-01 is a round-number floor that excludes the noisiest period
// while keeping enough history for week/month/year charts to look like
// charts. Mirrors NAV's data-cutoff.ts pattern.
//
// Enforced in three places, in upstream-to-downstream order:
//   1. supabase/migrations/0066_media_snapshot_floor.sql — the snapshot
//      refresh functions skip pre-cutoff rows when aggregating
//      media_articles. This is the real floor.
//   2. PostgREST query layer in app/(site)/media/page.tsx — redundant
//      &date=gte. / &published_on=gte. filters trim payload size and
//      defend against any hand-inserted / stale snapshot rows.
//   3. Scroller's coverageMs clamp — last-mile defense for the
//      "data goes back to X" footer.
// If you bump this constant, also bump the literal '2024-01-01' in
// migration 0066. They must stay in sync.
export const MEDIA_DATA_CUTOFF = "2024-01-01";

export const MEDIA_DATA_CUTOFF_MS = new Date(
  MEDIA_DATA_CUTOFF + "T00:00:00Z",
).getTime();
