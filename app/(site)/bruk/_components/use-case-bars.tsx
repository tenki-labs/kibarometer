"use client";

// Horizontal bar chart of Q4 (use cases). Multi-select — shares are
// independent, not summing to 100%.

import * as React from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

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
  skriving: "Skriving",
  soek: "Søk og research",
  oppsummering: "Oppsummering",
  koding: "Programmering",
  oversettelse: "Oversettelse",
  laering: "Læring",
  idemyldring: "Idémyldring",
  bildegen: "Bildegenerering",
  dataanalyse: "Dataanalyse",
  underholdning: "Underholdning",
  annet: "Annet",
};

export function UseCaseBars({ rows }: Props) {
  const data = React.useMemo(
    () =>
      [...rows]
        .sort((a, b) => b.confirmed_count - a.confirmed_count)
        .map((r) => ({
          use_case: LABELS[r.bucket] ?? r.bucket,
          count: r.confirmed_count,
          share: r.share_pct ?? 0,
        })),
    [rows],
  );

  const chartConfig = React.useMemo<ChartConfig>(
    () => ({
      share: { label: "Andel", color: "var(--color-chart-2)" },
    }),
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
    <ChartContainer config={chartConfig} className="h-[320px] w-full">
      <BarChart
        data={data}
        layout="vertical"
        margin={{ left: 8, right: 24, top: 8, bottom: 8 }}
      >
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis
          type="number"
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => `${v as number} %`}
        />
        <YAxis
          dataKey="use_case"
          type="category"
          tickLine={false}
          axisLine={false}
          width={120}
          fontSize={12}
        />
        <ChartTooltip content={<ChartTooltipContent hideLabel />} />
        <Bar
          dataKey="share"
          fill="var(--color-chart-2)"
          radius={[0, 2, 2, 0]}
          isAnimationActive={false}
        />
      </BarChart>
    </ChartContainer>
  );
}
