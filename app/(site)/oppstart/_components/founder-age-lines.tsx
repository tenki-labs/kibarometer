"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  formatBucket,
  formatBucketShort,
} from "@/app/(site)/_components/bucket-format";
import type { BrregSnapshotFounderAgeMonthly } from "@/lib/supabase";

import type { Range } from "@/app/(site)/_components/time-range-toggle";
import { dateKey, rangeCutoffMs } from "@/app/(site)/_lib/range";

type Props = {
  rows: BrregSnapshotFounderAgeMonthly[];
  range: Range;
  nowMs: number;
};

type Point = {
  bucket: string;                  // YYYY-MM for x-axis formatting
  monthMs: number;
  aiMedian: number | null;
  nonAiMedian: number | null;
  aiP25: number | null;
  aiP75: number | null;
  nonAiP25: number | null;
  nonAiP75: number | null;
  aiSample: number;
  nonAiSample: number;
};

const NB = new Intl.NumberFormat("nb-NO");
const SAMPLE_FLOOR = 25;

const chartConfig = {
  aiMedian: { label: "AI-relevante", color: "var(--chart-1)" },
  nonAiMedian: { label: "Ikke-AI", color: "var(--chart-3)" },
} satisfies ChartConfig;

function fmtAge(v: number | null): string {
  if (v === null) return "—";
  return v.toFixed(1).replace(".", ",") + " år";
}

export function FounderAgeLines({ rows, range, nowMs }: Props) {
  const points = useMemo<Point[]>(() => {
    const cutoffMs = rangeCutoffMs(range, nowMs);
    const byMonth = new Map<string, Point>();
    for (const r of rows) {
      const monthMs = new Date(r.reg_month + "T00:00:00Z").getTime();
      if (monthMs < cutoffMs) continue;
      const bucket = dateKey(r.reg_month, "month");
      const cur =
        byMonth.get(bucket) ??
        ({
          bucket,
          monthMs,
          aiMedian: null,
          nonAiMedian: null,
          aiP25: null,
          aiP75: null,
          nonAiP25: null,
          nonAiP75: null,
          aiSample: 0,
          nonAiSample: 0,
        } as Point);
      if (r.is_ai_relevant) {
        cur.aiMedian = r.median_youngest_age;
        cur.aiP25 = r.p25_youngest_age;
        cur.aiP75 = r.p75_youngest_age;
        cur.aiSample = r.sample_size;
      } else {
        cur.nonAiMedian = r.median_youngest_age;
        cur.nonAiP25 = r.p25_youngest_age;
        cur.nonAiP75 = r.p75_youngest_age;
        cur.nonAiSample = r.sample_size;
      }
      byMonth.set(bucket, cur);
    }
    return [...byMonth.values()].sort((a, b) => a.monthMs - b.monthMs);
  }, [rows, range, nowMs]);

  if (points.length === 0) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        Ingen grunnlegger-data i denne perioden.
      </div>
    );
  }

  // Auto Y-domain. Pad both ends for breathing room; floor at 0.
  const allAges = points.flatMap((p) =>
    [p.aiMedian, p.nonAiMedian, p.aiP25, p.aiP75, p.nonAiP25, p.nonAiP75].filter(
      (v): v is number => v != null,
    ),
  );
  const minAge =
    allAges.length === 0
      ? 0
      : Math.max(0, Math.floor(Math.min(...allAges) / 5) * 5 - 5);
  const maxAge =
    allAges.length === 0 ? 60 : Math.ceil(Math.max(...allAges) / 5) * 5 + 5;

  // With a single visible point, recharts won't draw a line — force the
  // dot back on so the chart still communicates the data point.
  const showDots = points.length === 1;

  return (
    <ChartContainer config={chartConfig} className="h-full w-full">
      <LineChart data={points} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="bucket"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={32}
          tickFormatter={formatBucketShort}
        />
        <YAxis
          domain={[minAge, maxAge]}
          tickFormatter={(v) => `${v}`}
          tickLine={false}
          axisLine={false}
          width={36}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              indicator="dot"
              labelFormatter={(v) => formatBucket(String(v))}
              formatter={(value, name, item) => {
                const key = String(name);
                const p = item.payload as Point;
                const isAi = key === "aiMedian";
                const median =
                  typeof value === "number" ? value : Number(value) || null;
                const p25 = isAi ? p.aiP25 : p.nonAiP25;
                const p75 = isAi ? p.aiP75 : p.nonAiP75;
                const sample = isAi ? p.aiSample : p.nonAiSample;
                const label = isAi ? "AI-relevante" : "Ikke-AI";
                const lowSample = sample < SAMPLE_FLOOR;
                return (
                  <div className="flex w-full flex-col gap-1">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-mono font-medium tabular-nums text-foreground">
                        {fmtAge(median)}
                      </span>
                    </div>
                    {p25 !== null && p75 !== null ? (
                      <span className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
                        IQR {fmtAge(p25)} – {fmtAge(p75)}
                      </span>
                    ) : null}
                    <span
                      className={
                        "font-mono text-[0.65rem] uppercase tracking-[0.16em] " +
                        (lowSample
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-muted-foreground")
                      }
                    >
                      n = {NB.format(sample)}
                      {lowSample ? " · lavt utvalg" : ""}
                    </span>
                  </div>
                );
              }}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Line
          dataKey="aiMedian"
          type="monotone"
          stroke="var(--color-aiMedian)"
          strokeWidth={2}
          dot={showDots}
          connectNulls
          isAnimationActive={false}
        />
        <Line
          dataKey="nonAiMedian"
          type="monotone"
          stroke="var(--color-nonAiMedian)"
          strokeWidth={2}
          dot={showDots}
          connectNulls
          isAnimationActive={false}
        />
      </LineChart>
    </ChartContainer>
  );
}
