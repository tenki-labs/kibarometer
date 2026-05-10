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
  type ChartConfig,
} from "@/components/ui/chart";
import {
  formatBucket,
  formatBucketShort,
} from "@/app/(site)/_components/bucket-format";
import { ChartHoverPanel } from "@/app/(site)/_components/chart-hover-panel";
import { useChartInteraction } from "@/app/(site)/_components/use-chart-interaction";
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
  aiMean: number | null;
  nonAiMean: number | null;
  aiStddev: number | null;
  nonAiStddev: number | null;
  aiSample: number;
  nonAiSample: number;
};

const NB = new Intl.NumberFormat("nb-NO");
const SAMPLE_FLOOR = 25;

const chartConfig = {
  aiMean: { label: "AI-relevante", color: "var(--chart-1)" },
  nonAiMean: { label: "Ikke-AI", color: "var(--chart-3)" },
} satisfies ChartConfig;

function fmtAge(v: number | null): string {
  if (v === null) return "—";
  return v.toFixed(1).replace(".", ",") + " år";
}

function fmtStddev(v: number | null): string {
  if (v === null) return "—";
  return "± " + v.toFixed(1).replace(".", ",") + " år";
}

export function FounderAgeLines({ rows, range, nowMs }: Props) {
  const { tooltipTrigger } = useChartInteraction();

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
          aiMean: null,
          nonAiMean: null,
          aiStddev: null,
          nonAiStddev: null,
          aiSample: 0,
          nonAiSample: 0,
        } as Point);
      if (r.is_ai_relevant) {
        cur.aiMean = r.mean_youngest_age;
        cur.aiStddev = r.stddev_youngest_age;
        cur.aiSample = r.sample_size;
      } else {
        cur.nonAiMean = r.mean_youngest_age;
        cur.nonAiStddev = r.stddev_youngest_age;
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
    [p.aiMean, p.nonAiMean].filter((v): v is number => v != null),
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
          trigger={tooltipTrigger}
          cursor={{ strokeDasharray: "3 3" }}
          wrapperStyle={{ transition: "none" }}
          isAnimationActive={false}
          animationDuration={0}
          content={
            <ChartHoverPanel
              mode="single"
              header={(label) =>
                typeof label === "string" ? formatBucket(label) : String(label)
              }
              rows={(payload) =>
                payload
                  .map((item) => {
                    const key = String(item.dataKey ?? item.name ?? "");
                    if (key !== "aiMean" && key !== "nonAiMean") return null;
                    const p = item.payload as Point | undefined;
                    if (!p) return null;
                    const isAi = key === "aiMean";
                    const mean =
                      typeof item.value === "number"
                        ? item.value
                        : Number(item.value) || null;
                    const stddev = isAi ? p.aiStddev : p.nonAiStddev;
                    const sample = isAi ? p.aiSample : p.nonAiSample;
                    const lowSample = sample < SAMPLE_FLOOR;
                    const stddevStr =
                      stddev !== null ? fmtStddev(stddev) : null;
                    const sampleStr = `n = ${NB.format(sample)}${
                      lowSample ? " · lavt utvalg" : ""
                    }`;
                    return {
                      key,
                      label: isAi ? "AI-relevante" : "Ikke-AI",
                      color: item.color,
                      value: fmtAge(mean),
                      sub: (
                        <>
                          {stddevStr ? (
                            <span className="block">{stddevStr}</span>
                          ) : null}
                          <span
                            className={
                              "block " +
                              (lowSample
                                ? "text-amber-600 dark:text-amber-400"
                                : "")
                            }
                          >
                            {sampleStr}
                          </span>
                        </>
                      ),
                    };
                  })
                  .filter((r): r is NonNullable<typeof r> => r !== null)
              }
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Line
          dataKey="aiMean"
          type="monotone"
          stroke="var(--color-aiMean)"
          strokeWidth={2}
          dot={showDots}
          connectNulls
          isAnimationActive={false}
        />
        <Line
          dataKey="nonAiMean"
          type="monotone"
          stroke="var(--color-nonAiMean)"
          strokeWidth={2}
          dot={showDots}
          connectNulls
          isAnimationActive={false}
        />
      </LineChart>
    </ChartContainer>
  );
}
