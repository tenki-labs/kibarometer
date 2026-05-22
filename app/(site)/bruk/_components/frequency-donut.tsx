"use client";

// Donut chart of Q2 (frequency) responses. Shares sum to 100%.

import * as React from "react";
import { Cell, Pie, PieChart } from "recharts";

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

const LABELS: Record<string, string> = {
  daglig: "Hver dag",
  ukentlig: "Flere ganger i uken",
  "av-og-til": "Av og til",
  "proevd-ikke-regelmessig": "Prøvd, ikke regelmessig",
  aldri: "Aldri",
};

const ORDER = ["daglig", "ukentlig", "av-og-til", "proevd-ikke-regelmessig", "aldri"];

const COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

export function FrequencyDonut({ rows }: Props) {
  const data = React.useMemo(() => {
    const byBucket = new Map(rows.map((r) => [r.bucket, r]));
    return ORDER.flatMap((bucket, idx) => {
      const r = byBucket.get(bucket);
      if (!r) return [];
      return [{
        name: LABELS[bucket] ?? bucket,
        value: r.confirmed_count,
        share: r.share_pct ?? 0,
        fill: COLORS[idx % COLORS.length],
      }];
    });
  }, [rows]);

  const chartConfig = React.useMemo<ChartConfig>(
    () =>
      Object.fromEntries(
        ORDER.map((bucket, idx) => [
          bucket,
          { label: LABELS[bucket] ?? bucket, color: COLORS[idx % COLORS.length] },
        ]),
      ),
    [],
  );

  if (data.length === 0) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        Ingen svar registrert ennå.
      </div>
    );
  }

  return (
    <ChartContainer config={chartConfig} className="mx-auto aspect-square h-[240px]">
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent hideLabel />} />
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={55}
          outerRadius={90}
          isAnimationActive={false}
        >
          {data.map((d, i) => (
            <Cell key={i} fill={d.fill} />
          ))}
        </Pie>
      </PieChart>
    </ChartContainer>
  );
}
