import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the PostgREST client so we can assert the query path and feed rows
// without a live database.
vi.mock("@/lib/supabase", () => ({ sb: vi.fn() }));

import { sb } from "@/lib/supabase";
import { JOBBMARKED_DATA_CUTOFF } from "@/app/(site)/_lib/data-cutoff";
import {
  bucketMonthly,
  getJobsTrendMonthly,
  getJobsHeadlineRecent,
} from "./jobs";

describe("bucketMonthly", () => {
  it("sums daily rows into first-of-month buckets", () => {
    const out = bucketMonthly([
      { posted_on: "2026-04-13", ai_count: 2, total_count: 10 },
      { posted_on: "2026-04-20", ai_count: 3, total_count: 12 },
      { posted_on: "2026-05-01", ai_count: 1, total_count: 5 },
    ]);
    expect(out).toEqual([
      { posted_month: "2026-04-01", ai_count: 5, total_count: 22 },
      { posted_month: "2026-05-01", ai_count: 1, total_count: 5 },
    ]);
  });

  it("orders months ascending regardless of input order", () => {
    const out = bucketMonthly([
      { posted_on: "2026-06-02", ai_count: 1, total_count: 1 },
      { posted_on: "2026-04-30", ai_count: 1, total_count: 1 },
      { posted_on: "2026-05-15", ai_count: 1, total_count: 1 },
    ]);
    expect(out.map((r) => r.posted_month)).toEqual([
      "2026-04-01",
      "2026-05-01",
      "2026-06-01",
    ]);
  });

  it("returns an empty array for no rows", () => {
    expect(bucketMonthly([])).toEqual([]);
  });
});

describe("getJobsTrendMonthly", () => {
  beforeEach(() => vi.mocked(sb).mockReset());

  it("reads snapshot_daily floored at the jobs data cutoff", async () => {
    vi.mocked(sb).mockResolvedValue([]);
    await getJobsTrendMonthly();
    expect(sb).toHaveBeenCalledTimes(1);
    const path = vi.mocked(sb).mock.calls[0][0] as string;
    expect(path).toContain("/snapshot_daily");
    expect(path).toContain(`posted_on=gte.${JOBBMARKED_DATA_CUTOFF}`);
  });

  it("returns the floored daily series bucketed to month", async () => {
    vi.mocked(sb).mockResolvedValue([
      { posted_on: "2026-04-13", ai_count: 2, total_count: 10 },
      { posted_on: "2026-04-20", ai_count: 3, total_count: 12 },
    ]);
    const out = await getJobsTrendMonthly();
    expect(out).toEqual([
      { posted_month: "2026-04-01", ai_count: 5, total_count: 22 },
    ]);
  });
});

describe("getJobsHeadlineRecent", () => {
  beforeEach(() => vi.mocked(sb).mockReset());

  it("returns the latest headline row plus the recent daily window", async () => {
    const headline = {
      computed_for: "2026-06-07",
      computed_at: "2026-06-07T04:00:00Z",
      ai_count_7d: 5,
      ai_count_30d: 20,
      ai_count_prev_30d: 18,
      ai_share_30d: 0.02,
    };
    const daily = [{ posted_on: "2026-06-07", ai_count: 1, total_count: 50 }];
    vi.mocked(sb)
      .mockResolvedValueOnce([headline]) // snapshot_headline call
      .mockResolvedValueOnce(daily); // snapshot_daily call
    const out = await getJobsHeadlineRecent();
    expect(out).toEqual({ headline, recentDaily: daily });
  });

  it("reads only the recent daily window, not the full history", async () => {
    vi.mocked(sb).mockResolvedValue([]);
    await getJobsHeadlineRecent();
    const dailyPath = vi
      .mocked(sb)
      .mock.calls.map((c) => c[0] as string)
      .find((p) => p.includes("/snapshot_daily"));
    expect(dailyPath).toBeDefined();
    expect(dailyPath).toContain("limit=30");
    expect(dailyPath).toContain("order=posted_on.desc");
  });

  it("yields a null headline when there are no rows", async () => {
    vi.mocked(sb).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const out = await getJobsHeadlineRecent();
    expect(out.headline).toBeNull();
    expect(out.recentDaily).toEqual([]);
  });
});
