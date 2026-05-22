"use client";

// Donut chart of Q5 (workplace AI policy) responses. Only bransje
// respondents have a Q5 value (privatperson skips), so the denominator is
// "bransje respondents only" — share_pct from the snapshot already accounts
// for this.

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
  sanksjonert: "Tillatt og sanksjonert",
  tolerert: "Uoffisielt tolerert",
  uklart: "Uklart / ingen policy",
  fraraadet: "Frarådet eller forbudt",
  "vet-ikke": "Vet ikke",
};

const ORDER = ["sanksjonert", "tolerert", "uklart", "fraraadet", "vet-ikke"];

const COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-destructive)",
  "var(--color-chart-5)",
];

export function WorkplaceDonut({ rows }: Props) {
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
        Ingen bransje-respondenter ennå.
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
