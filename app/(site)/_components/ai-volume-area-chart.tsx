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
import { AI_COLOR } from "@/lib/palette";

import { formatBucket, formatBucketShort } from "./bucket-format";
import { ChartHoverPanel } from "./chart-hover-panel";
import { useChartInteraction } from "./use-chart-interaction";

// Bucket carries both numbers — area plots the count, tooltip shows the
// share. Same shape feeds /arbeidsmarked + /oppstart.
export type AIShareBucket = {
  date: string;
  aiCount: number;
  totalCount: number;
};

type Props = {
  buckets: AIShareBucket[];
  /** Unit shown in the tooltip footer ("av N stillinger" / "av N foretak"). */
  unitLabel?: string;
};

const COUNT_KEY = "aiCount";
const NB_INT = new Intl.NumberFormat("nb-NO");

// Area chart of AI volume over time. Earlier versions plotted ai_share
// (ai_count / total_count) as the area, but small-denominator weeks at
// the start of NAV / BRREG ingest produced 25-33% spikes from 1-3
// postings. Switching to absolute count eliminates that artifact — the
// share is still present in the tooltip for context.
export function AIVolumeAreaChart({ buckets, unitLabel = "stillinger" }: Props) {
  const { tooltipTrigger } = useChartInteraction();

  const data = useMemo(
    () =>
      buckets
        .filter((b) => b.totalCount > 0)
        .map((b) => ({
          date: b.date,
          aiCount: b.aiCount,
          totalCount: b.totalCount,
        })),
    [buckets],
  );

  const chartConfig = useMemo<ChartConfig>(
    () => ({
      [COUNT_KEY]: {
        label: "AI-treff",
        color: AI_COLOR,
      },
    }),
    [],
  );

  if (data.length === 0) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        Ingen data i denne perioden.
      </div>
    );
  }

  return (
    <ChartContainer config={chartConfig} className="h-full w-full">
      <AreaChart data={data} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
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
          tickMargin={4}
          width={48}
          allowDecimals={false}
          tickFormatter={(v) => NB_INT.format(v as number)}
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
                const p = item?.payload as
                  | { aiCount: number; totalCount: number }
                  | undefined;
                if (!p) return [];
                const share = p.totalCount > 0 ? p.aiCount / p.totalCount : 0;
                return [
                  {
                    key: COUNT_KEY,
                    label: "AI-treff",
                    color: item?.color,
                    value: NB_INT.format(p.aiCount),
                    sub: `${(share * 100).toFixed(2).replace(".", ",")} % av ${NB_INT.format(p.totalCount)} ${unitLabel}`,
                  },
                ];
              }}
            />
          }
        />
        <Area
          dataKey={COUNT_KEY}
          type="linear"
          stroke={`var(--color-${COUNT_KEY})`}
          fill={`var(--color-${COUNT_KEY})`}
          fillOpacity={0.7}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}
