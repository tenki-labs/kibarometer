"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { MediaSnapshotIndex } from "@/lib/supabase";

type Props = {
  rows: MediaSnapshotIndex[];
  cutoffMs: number | null;
  monthly: boolean;
};

const NO_DATE_FMT_FULL = new Intl.DateTimeFormat("nb-NO", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});
const NO_DATE_FMT_MONTH = new Intl.DateTimeFormat("nb-NO", {
  month: "long",
  year: "numeric",
});

function formatBucket(bucket: string): string {
  if (bucket.length === 7) {
    return NO_DATE_FMT_MONTH.format(new Date(bucket + "-01T00:00:00Z"));
  }
  return NO_DATE_FMT_FULL.format(new Date(bucket + "T00:00:00Z"));
}

function formatBucketShort(bucket: string): string {
  if (bucket.length === 7) {
    return new Intl.DateTimeFormat("nb-NO", {
      month: "short",
      year: "2-digit",
    }).format(new Date(bucket + "-01T00:00:00Z"));
  }
  return new Intl.DateTimeFormat("nb-NO", {
    day: "2-digit",
    month: "short",
  }).format(new Date(bucket + "T00:00:00Z"));
}

function indexLabel(value: number): string {
  if (value >= 65) return "Begeistret tilt";
  if (value >= 55) return "Lett positiv";
  if (value >= 45) return "Balansert";
  if (value >= 35) return "Lett negativ";
  return "Bekymret tilt";
}

const chartConfig = {
  index: {
    label: "Kibarometer-indeks",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

export function IndexBar({ rows, cutoffMs, monthly }: Props) {
  const data = useMemo(() => {
    const cutoff = cutoffMs ?? -Infinity;
    const buckets = new Map<string, { sum: number; n: number }>();
    for (const row of rows) {
      const t = new Date(row.date + "T00:00:00Z").getTime();
      if (t < cutoff) continue;
      const key = monthly ? row.date.slice(0, 7) : row.date.slice(0, 10);
      const cur = buckets.get(key) ?? { sum: 0, n: 0 };
      cur.sum += row.index_value;
      cur.n += 1;
      buckets.set(key, cur);
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, index: Math.round(v.sum / Math.max(1, v.n)) }));
  }, [rows, cutoffMs, monthly]);

  if (data.length === 0) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        Ingen data i denne perioden.
      </div>
    );
  }

  return (
    <ChartContainer config={chartConfig} className="h-full w-full">
      <BarChart data={data} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={32}
          tickFormatter={formatBucketShort}
        />
        <YAxis
          domain={[0, 100]}
          ticks={[0, 25, 50, 75, 100]}
          tickLine={false}
          axisLine={false}
          width={28}
        />
        <ReferenceLine
          y={50}
          stroke="var(--border)"
          strokeDasharray="4 4"
          ifOverflow="visible"
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              indicator="dot"
              labelFormatter={(value) =>
                typeof value === "string" ? formatBucket(value) : String(value)
              }
              formatter={(value) => {
                const numeric = typeof value === "number" ? value : Number(value) || 0;
                return (
                  <div className="flex w-full flex-col gap-1">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">
                        Indeks
                      </span>
                      <span className="font-mono font-medium tabular-nums text-foreground">
                        {numeric}
                      </span>
                    </div>
                    <span className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
                      {indexLabel(numeric)} (50 = balansert)
                    </span>
                  </div>
                );
              }}
            />
          }
        />
        <Bar
          dataKey="index"
          fill="var(--color-index)"
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
        />
      </BarChart>
    </ChartContainer>
  );
}
