"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
import type { BrregSnapshotDaily } from "@/lib/supabase";

import {
  rangeToCutoffMs,
  shouldBucketMonthly,
  type OppstartRange,
} from "./range-utils";

type Props = {
  rows: BrregSnapshotDaily[];
  range: OppstartRange;
  nowMs: number;
};

type Point = {
  bucket: string;
  aiShare: number;
  nonAiShare: number;
  aiCount: number;
  total: number;
};

const NB = new Intl.NumberFormat("nb-NO");
const SAMPLE_FLOOR = 25;

const chartConfig = {
  aiShare: { label: "AI-relevante", color: "var(--chart-1)" },
  nonAiShare: { label: "Ikke-AI", color: "var(--chart-3)" },
} satisfies ChartConfig;

export function AiShareBars({ rows, range, nowMs }: Props) {
  const points = useMemo<Point[]>(() => {
    const cutoffMs = rangeToCutoffMs(range, nowMs);
    const monthly = shouldBucketMonthly(range);
    const buckets = new Map<string, { ai: number; total: number }>();
    for (const row of rows) {
      const t = new Date(row.registrert_dato + "T00:00:00Z").getTime();
      if (t < cutoffMs) continue;
      const key = monthly
        ? row.registrert_dato.slice(0, 7)
        : row.registrert_dato;
      const cur = buckets.get(key) ?? { ai: 0, total: 0 };
      cur.ai += row.ai_relevant_count;
      cur.total += row.count;
      buckets.set(key, cur);
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bucket, v]) => ({
        bucket,
        aiShare: v.total > 0 ? v.ai / v.total : 0,
        nonAiShare: v.total > 0 ? (v.total - v.ai) / v.total : 0,
        aiCount: v.ai,
        total: v.total,
      }));
  }, [rows, range, nowMs]);

  if (points.length === 0) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        Ingen data i denne perioden.
      </div>
    );
  }

  return (
    <ChartContainer config={chartConfig} className="h-full w-full">
      <BarChart
        data={points}
        margin={{ left: 8, right: 8, top: 8, bottom: 0 }}
      >
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
          domain={[0, 1]}
          ticks={[0, 0.25, 0.5, 0.75, 1]}
          tickFormatter={(v) => `${Math.round((v as number) * 100)} %`}
          tickLine={false}
          axisLine={false}
          width={40}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              indicator="dot"
              labelFormatter={(v) => formatBucket(String(v))}
              formatter={(value, name, item) => {
                const p = item.payload as Point;
                const isAi = String(name) === "aiShare";
                const sharePct = (Number(value) * 100)
                  .toFixed(1)
                  .replace(".", ",");
                return (
                  <div className="flex w-full flex-col gap-1">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">
                        {isAi ? "AI-relevante" : "Ikke-AI"}
                      </span>
                      <span className="font-mono font-medium tabular-nums">
                        {sharePct} %
                      </span>
                    </div>
                    {isAi ? (
                      <span className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
                        {NB.format(p.aiCount)} av {NB.format(p.total)} foretak
                      </span>
                    ) : null}
                  </div>
                );
              }}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar
          dataKey="aiShare"
          stackId="a"
          fill="var(--color-aiShare)"
          isAnimationActive={false}
        >
          {points.map((p) => (
            <Cell
              key={p.bucket}
              fillOpacity={p.total < SAMPLE_FLOOR ? 0.45 : 1}
            />
          ))}
        </Bar>
        <Bar
          dataKey="nonAiShare"
          stackId="a"
          fill="var(--color-nonAiShare)"
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
        >
          {points.map((p) => (
            <Cell
              key={p.bucket}
              fillOpacity={p.total < SAMPLE_FLOOR ? 0.45 : 1}
            />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
