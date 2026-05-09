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
import { AI_COLOR } from "@/lib/palette";

import { formatBucket, formatBucketShort } from "./bucket-format";

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

const SHARE_KEY = "share";

export function AIShareAreaChart({ buckets, unitLabel = "stillinger" }: Props) {
  const data = useMemo(
    () =>
      buckets
        .filter((b) => b.totalCount > 0)
        .map((b) => ({
          date: b.date,
          [SHARE_KEY]: b.aiCount / b.totalCount,
          aiCount: b.aiCount,
          totalCount: b.totalCount,
        })),
    [buckets],
  );

  const chartConfig = useMemo<ChartConfig>(
    () => ({
      [SHARE_KEY]: {
        label: "AI-andel",
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
          tickFormatter={(v) =>
            `${((v as number) * 100).toFixed(1).replace(".", ",")} %`
          }
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              indicator="dot"
              labelFormatter={(value) =>
                typeof value === "string" ? formatBucket(value) : String(value)
              }
              formatter={(_value, _name, item) => {
                const p = item.payload as
                  | { aiCount: number; totalCount: number }
                  | undefined;
                if (!p) return null;
                const share = p.totalCount > 0 ? p.aiCount / p.totalCount : 0;
                return (
                  <div className="flex w-full flex-col gap-1">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">AI-andel</span>
                      <span className="font-mono font-medium tabular-nums text-foreground">
                        {(share * 100).toFixed(2).replace(".", ",")} %
                      </span>
                    </div>
                    <span className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
                      {p.aiCount.toLocaleString("nb-NO")} av{" "}
                      {p.totalCount.toLocaleString("nb-NO")} {unitLabel}
                    </span>
                  </div>
                );
              }}
            />
          }
        />
        <Area
          dataKey={SHARE_KEY}
          type="monotone"
          stroke={`var(--color-${SHARE_KEY})`}
          fill={`var(--color-${SHARE_KEY})`}
          fillOpacity={0.7}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}
