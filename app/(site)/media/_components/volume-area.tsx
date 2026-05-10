"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
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

import {
  formatBucket,
  formatBucketShort,
} from "@/app/(site)/_components/bucket-format";
import { dateKey } from "@/app/(site)/_lib/range";

type Props = {
  rows: MediaSnapshotCategoryDaily[];
  cutoffMs: number | null;
  monthly: boolean;
};

const NB = new Intl.NumberFormat("nb-NO");

const chartConfig = {
  count: {
    label: "AI-artikler",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

export function VolumeArea({ rows, cutoffMs, monthly }: Props) {
  const data = useMemo(() => {
    // Each row in `rows` is one (published_on, category_slug) — sum across
    // categories per bucket to get the daily/monthly total AI count. Drops
    // distinct-story dedup since the public chart wants raw volume.
    const byBucket = new Map<string, number>();
    const cutoff = cutoffMs ?? -Infinity;
    for (const r of rows) {
      const t = new Date(r.published_on + "T00:00:00Z").getTime();
      if (t < cutoff) continue;
      if (r.ai_count === 0) continue;
      const key = dateKey(r.published_on, monthly);
      byBucket.set(key, (byBucket.get(key) ?? 0) + r.ai_count);
    }
    return [...byBucket.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));
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
      <AreaChart
        data={data}
        margin={{ left: 8, right: 8, top: 8, bottom: 0 }}
      >
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
          tickLine={false}
          axisLine={false}
          width={32}
          allowDecimals={false}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              indicator="dot"
              labelFormatter={(value) =>
                typeof value === "string"
                  ? formatBucket(value)
                  : String(value)
              }
              formatter={(value) => {
                const numeric =
                  typeof value === "number" ? value : Number(value) || 0;
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
        <Area
          dataKey="count"
          type={data.length < 3 ? "step" : "monotone"}
          stroke="var(--color-count)"
          fill="var(--color-count)"
          fillOpacity={0.55}
          strokeWidth={2}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}
