"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { MediaSnapshotCategoryDaily } from "@/lib/supabase";

type Props = {
  rows: MediaSnapshotCategoryDaily[];
  /** Reference "now" anchored to the latest published_on across rows. */
  nowMs: number;
  /** How far back to render in days. Defaults to 90. */
  days?: number;
};

const NB = new Intl.NumberFormat("nb-NO");

const NO_DATE_FMT_FULL = new Intl.DateTimeFormat("nb-NO", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});

function formatBucket(bucket: string): string {
  return NO_DATE_FMT_FULL.format(new Date(bucket + "T00:00:00Z"));
}

function formatBucketShort(bucket: string): string {
  return new Intl.DateTimeFormat("nb-NO", {
    day: "2-digit",
    month: "short",
  }).format(new Date(bucket + "T00:00:00Z"));
}

const chartConfig = {
  count: {
    label: "AI-artikler",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

export function VolumeBar({ rows, nowMs, days = 90 }: Props) {
  const data = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const r of rows) {
      byDay.set(r.published_on, (byDay.get(r.published_on) ?? 0) + r.ai_count);
    }
    const out: { date: string; count: number }[] = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const date = new Date(nowMs - i * 86_400_000)
        .toISOString()
        .slice(0, 10);
      out.push({ date, count: byDay.get(date) ?? 0 });
    }
    return out;
  }, [rows, nowMs, days]);

  if (data.every((d) => d.count === 0)) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        Ingen klassifiserte artikler ennå.
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
          minTickGap={48}
          tickFormatter={formatBucketShort}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={28}
          allowDecimals={false}
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
                  <div className="flex w-full items-center justify-between gap-3">
                    <span className="text-muted-foreground">AI-artikler</span>
                    <span className="font-mono font-medium tabular-nums text-foreground">
                      {NB.format(numeric)}
                    </span>
                  </div>
                );
              }}
            />
          }
        />
        <Bar
          dataKey="count"
          fill="var(--color-count)"
          radius={[3, 3, 0, 0]}
          isAnimationActive={false}
        />
      </BarChart>
    </ChartContainer>
  );
}
