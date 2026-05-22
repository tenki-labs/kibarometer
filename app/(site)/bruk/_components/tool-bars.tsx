"use client";

// Horizontal bar chart of Q3 (tools used). Multi-select means shares don't
// sum to 100% — bars are independent.

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
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  copilot: "Copilot",
  perplexity: "Perplexity",
  lokal: "Lokal modell",
  andre: "Andre",
  "vil-ikke-svare": "Vil ikke svare",
};

export function ToolBars({ rows }: Props) {
  const data = React.useMemo(
    () =>
      [...rows]
        .sort((a, b) => b.confirmed_count - a.confirmed_count)
        .map((r) => ({
          tool: LABELS[r.bucket] ?? r.bucket,
          count: r.confirmed_count,
          share: r.share_pct ?? 0,
        })),
    [rows],
  );

  const chartConfig = React.useMemo<ChartConfig>(
    () => ({
      count: { label: "Andel", color: "var(--color-chart-1)" },
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
    <ChartContainer
      config={chartConfig}
      className="h-[260px] w-full"
    >
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
          dataKey="tool"
          type="category"
          tickLine={false}
          axisLine={false}
          width={110}
          fontSize={12}
        />
        <ChartTooltip content={<ChartTooltipContent hideLabel />} />
        <Bar
          dataKey="share"
          fill="var(--color-chart-1)"
          radius={[0, 2, 2, 0]}
          isAnimationActive={false}
        />
      </BarChart>
    </ChartContainer>
  );
}
