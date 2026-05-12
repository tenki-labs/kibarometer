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
  type ChartConfig,
} from "@/components/ui/chart";
import type { MediaSnapshotCategoryDaily } from "@/lib/supabase";

import {
  formatBucket,
  formatBucketShort,
} from "@/app/(site)/_components/bucket-format";
import { ChartHoverPanel } from "@/app/(site)/_components/chart-hover-panel";
import { useChartInteraction } from "@/app/(site)/_components/use-chart-interaction";
import { dateKey, type BucketGrain } from "@/app/(site)/_lib/range";

type Props = {
  rows: MediaSnapshotCategoryDaily[];
  cutoffMs: number | null;
  grain: BucketGrain;
};

const NB = new Intl.NumberFormat("nb-NO");

const chartConfig = {
  count: {
    label: "AI-artikler",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

export function VolumeArea({ rows, cutoffMs, grain }: Props) {
  const { tooltipTrigger } = useChartInteraction();

  const data = useMemo(() => {
    // Each row in `rows` is one (published_on, category_slug) — sum across
    // categories per bucket to get the per-bucket total AI count. Drops
    // distinct-story dedup since the public chart wants raw volume.
    const byBucket = new Map<string, number>();
    const cutoff = cutoffMs ?? -Infinity;
    for (const r of rows) {
      const t = new Date(r.published_on + "T00:00:00Z").getTime();
      if (t < cutoff) continue;
      if (r.ai_count === 0) continue;
      const key = dateKey(r.published_on, grain);
      byBucket.set(key, (byBucket.get(key) ?? 0) + r.ai_count);
    }
    return [...byBucket.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));
  }, [rows, cutoffMs, grain]);

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
              rows={(payload) => {
                const item = payload[0];
                const numeric =
                  typeof item?.value === "number"
                    ? item.value
                    : Number(item?.value) || 0;
                return [
                  {
                    key: "count",
                    label: "AI-artikler",
                    color: item?.color,
                    value: NB.format(numeric),
                  },
                ];
              }}
            />
          }
        />
        <Area
          dataKey="count"
          type={data.length < 3 ? "step" : "linear"}
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
