import { describe, expect, it } from "vitest";

import { buildMediaCardModel, type MediaIndexRow } from "./media-card";

// Helper: build an index row. Defaults model a "signal" day (real coverage).
function row(
  date: string,
  index_value: number,
  ai_article_count_7d = 5,
): MediaIndexRow {
  return { date, index_value, ai_article_count_7d };
}

describe("buildMediaCardModel", () => {
  it("returns null for empty input", () => {
    expect(buildMediaCardModel([])).toBeNull();
  });

  it("returns null when the latest day is the no-signal sentinel (0 AI articles)", () => {
    // This is the production failure: the media pipeline stalled ~10 days
    // ago, so refresh_media_snapshot_index emits index=50 with
    // ai_article_count_7d=0 for every recent day. Presenting that as a real
    // "50 / 100 · over snitt" reading is misleading — it must fall through
    // to the Empty card instead.
    const rows: MediaIndexRow[] = [
      row("2026-05-28", 50, 0),
      row("2026-05-27", 50, 0),
      row("2026-05-26", 50, 0),
      row("2026-05-20", 46, 6),
      row("2026-05-19", 49, 9),
      row("2026-05-18", 45, 10),
      row("2026-05-17", 45, 13),
      row("2026-05-16", 44, 20),
    ];
    expect(buildMediaCardModel(rows)).toBeNull();
  });

  it("excludes sentinel (0-article) days from the percentile distribution", () => {
    // A healthy latest reading, but the trailing window is padded with
    // sentinel 50s from an earlier outage. Those must NOT pull the
    // percentiles toward 50 — the level label has to reflect real readings.
    const rows: MediaIndexRow[] = [
      row("2026-06-10", 70, 8),
      row("2026-06-09", 35, 12),
      row("2026-06-08", 40, 10),
      row("2026-06-07", 38, 11),
      row("2026-06-06", 42, 9),
      // sentinel padding that must be ignored:
      row("2026-06-05", 50, 0),
      row("2026-06-04", 50, 0),
      row("2026-06-03", 50, 0),
      row("2026-06-02", 50, 0),
    ];
    const model = buildMediaCardModel(rows);
    expect(model).not.toBeNull();
    // p90 over the real readings {35,38,40,42,70} is well above 50; if the
    // sentinels had leaked in, the median would be pinned at 50.
    expect(model!.gauge.p50).toBeLessThan(50);
    expect(model!.gauge.p90).toBeGreaterThan(50);
  });

  it("returns null when there are too few real signal days to form a distribution", () => {
    const rows: MediaIndexRow[] = [
      row("2026-06-10", 70, 8),
      row("2026-06-09", 35, 12),
      row("2026-06-08", 50, 0),
      row("2026-06-07", 50, 0),
    ];
    expect(buildMediaCardModel(rows)).toBeNull();
  });

  it("builds a model from a healthy series with a fixed 0..100 scale", () => {
    const rows: MediaIndexRow[] = [
      row("2026-06-10", 57, 7),
      row("2026-06-09", 43, 9),
      row("2026-06-08", 41, 10),
      row("2026-06-07", 39, 10),
      row("2026-06-06", 38, 11),
      row("2026-06-05", 35, 12),
    ];
    const model = buildMediaCardModel(rows);
    expect(model).not.toBeNull();
    expect(model!.indexValue).toBe(57);
    expect(model!.aiArticleCount7d).toBe(7);
    expect(model!.gauge.value).toBe(57);
    expect(model!.gauge.min).toBe(0);
    expect(model!.gauge.max).toBe(100);
  });

  it("picks the latest row by date regardless of input ordering", () => {
    // Defensive: don't assume the caller pre-sorts date.desc.
    const rows: MediaIndexRow[] = [
      row("2026-06-06", 38, 11),
      row("2026-06-10", 57, 7),
      row("2026-06-08", 41, 10),
      row("2026-06-09", 43, 9),
      row("2026-06-07", 39, 10),
      row("2026-06-05", 35, 12),
    ];
    const model = buildMediaCardModel(rows);
    expect(model!.indexValue).toBe(57);
    expect(model!.aiArticleCount7d).toBe(7);
  });
});
