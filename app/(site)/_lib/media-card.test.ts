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
    // Production failure mode: the media pipeline stalled, so
    // refresh_media_snapshot_index emits index=50 with ai_article_count_7d=0
    // for every recent day. That must fall through to the Empty card.
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

  it("maps the latest index onto the diverging bar (50 = center), ignoring trailing sentinels", () => {
    const rows: MediaIndexRow[] = [
      row("2026-06-10", 70, 8),
      row("2026-06-09", 35, 12),
      row("2026-06-08", 40, 10),
      row("2026-06-07", 38, 11),
      row("2026-06-06", 42, 9),
      // sentinel padding from an earlier outage — must not block a reading:
      row("2026-06-05", 50, 0),
      row("2026-06-04", 50, 0),
    ];
    const model = buildMediaCardModel(rows);
    expect(model).not.toBeNull();
    // index 70 → warm side; divergingPct(70,50,50) = 70.
    expect(model!.markerPct).toBe(70);
    expect(model!.markerPct).toBeGreaterThan(50);
  });

  it("returns null when there are too few real signal days", () => {
    const rows: MediaIndexRow[] = [
      row("2026-06-10", 70, 8),
      row("2026-06-09", 35, 12),
      row("2026-06-08", 50, 0),
      row("2026-06-07", 50, 0),
    ];
    expect(buildMediaCardModel(rows)).toBeNull();
  });

  it("builds a model from a healthy series; a below-50 index lands cold", () => {
    const rows: MediaIndexRow[] = [
      row("2026-06-10", 43, 7),
      row("2026-06-09", 43, 9),
      row("2026-06-08", 41, 10),
      row("2026-06-07", 39, 10),
      row("2026-06-06", 38, 11),
      row("2026-06-05", 35, 12),
    ];
    const model = buildMediaCardModel(rows);
    expect(model).not.toBeNull();
    expect(model!.indexValue).toBe(43);
    expect(model!.aiArticleCount7d).toBe(7);
    expect(model!.markerPct).toBe(43); // < 50 → left of center (cold)
    expect(model!.markerPct).toBeLessThan(50);
  });

  it("picks the latest row by date regardless of input ordering", () => {
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
    expect(model!.markerPct).toBe(57);
  });
});
