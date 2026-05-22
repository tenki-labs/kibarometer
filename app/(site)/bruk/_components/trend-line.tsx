"use client";

// Line chart of weekly confirmation count over time. Powered by the
// 'by_week_confirmed' cut in bruk_aggregate_snapshot (bucket = ISO-week
// first-day date, confirmed_count = number of confirmations that week).

import * as React from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

type Row = {
  bucket: string;
  confirmed_count: number;
  share_pct: number | null;
};

type Props = {
  rows: Row[];
};

const NB_DATE = new Intl.DateTimeFormat("nb-NO", {
  day: "2-digit",
  month: "short",
});

function formatWeekShort(iso: string): string {
  try {
    return NB_DATE.format(new Date(`${iso}T00:00:00Z`));
  } catch {
    return iso;
  }
}

export function TrendLine({ rows }: Props) {
  const data = React.useMemo(
    () =>
      [...rows]
        .sort((a, b) => a.bucket.localeCompare(b.bucket))
        .map((r) => ({
          week: r.bucket,
          count: r.confirmed_count,
        })),
    [rows],
  );

  const chartConfig = React.useMemo<ChartConfig>(
    () => ({
      count: { label: "Bekreftelser", color: "var(--color-chart-1)" },
    }),
    [],
  );

  if (data.length < 2) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        Trenden vises når vi har minst to ukers data.
      </div>
    );
  }

  return (
    <ChartContainer config={chartConfig} className="h-[240px] w-full">
      <LineChart
        data={data}
        margin={{ left: 8, right: 16, top: 8, bottom: 0 }}
      >
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="week"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={32}
          tickFormatter={formatWeekShort}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          width={32}
          allowDecimals={false}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(v) =>
                typeof v === "string" ? formatWeekShort(v) : String(v)
              }
            />
          }
        />
        <Line
          dataKey="count"
          stroke="var(--color-chart-1)"
          strokeWidth={2}
          isAnimationActive={false}
          dot={{ r: 2 }}
        />
      </LineChart>
    </ChartContainer>
  );
}
