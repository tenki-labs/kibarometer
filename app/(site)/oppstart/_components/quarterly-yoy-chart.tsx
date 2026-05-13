"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart";
import { ChartHoverPanel } from "@/app/(site)/_components/chart-hover-panel";
import { useChartInteraction } from "@/app/(site)/_components/use-chart-interaction";
import {
  formatQuarterLong,
  formatQuarterShort,
} from "@/app/(site)/_lib/format-quarter";
import type { BrregSnapshotQuarterlyAiGrowth } from "@/lib/supabase";

type Props = {
  rows: BrregSnapshotQuarterlyAiGrowth[];
};

const NB_INT = new Intl.NumberFormat("nb-NO");

function fmtPct(pct: number | null): string {
  if (pct === null) return "—";
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  const abs = Math.abs(pct);
  return `${sign}${abs.toFixed(1).replace(".", ",")} %`;
}

// Bar chart of quarterly YoY % growth in AI-relevant BRREG registrations.
// Only completed quarters with a year-prior comparison render. Positive
// bars green-blue, negative bars red, zero line at y=0.
export function QuarterlyYoyChart({ rows }: Props) {
  const { tooltipTrigger } = useChartInteraction();

  const data = useMemo(
    () =>
      rows
        .filter((r) => r.yoy_growth_pct !== null)
        .map((r) => ({
          reg_quarter: r.reg_quarter,
          yoy_growth_pct: r.yoy_growth_pct as number,
          ai_count: r.ai_count,
          ai_count_yoy_prior: r.ai_count_yoy_prior,
        })),
    [rows],
  );

  const chartConfig = useMemo<ChartConfig>(
    () => ({
      yoy_growth_pct: {
        label: "YoY-vekst",
        color: "var(--color-chart-1)",
      },
    }),
    [],
  );

  if (data.length === 0) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        Ingen kvartaler med år/år-sammenligning ennå.
      </div>
    );
  }

  return (
    <ChartContainer config={chartConfig} className="h-full w-full">
      <BarChart data={data} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="reg_quarter"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={16}
          tickFormatter={formatQuarterShort}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          width={48}
          tickFormatter={(v) => `${v as number} %`}
        />
        <ReferenceLine y={0} stroke="var(--border)" />
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
                typeof label === "string" ? formatQuarterLong(label) : String(label)
              }
              rows={(payload) => {
                const item = payload[0];
                const p = item?.payload as
                  | {
                      yoy_growth_pct: number;
                      ai_count: number;
                      ai_count_yoy_prior: number | null;
                    }
                  | undefined;
                if (!p) return [];
                const prior =
                  p.ai_count_yoy_prior !== null
                    ? NB_INT.format(p.ai_count_yoy_prior)
                    : "—";
                return [
                  {
                    key: "yoy_growth_pct",
                    label: "Vekst år/år",
                    color:
                      p.yoy_growth_pct >= 0
                        ? "var(--color-chart-1)"
                        : "var(--color-destructive)",
                    value: fmtPct(p.yoy_growth_pct),
                    sub: `${NB_INT.format(p.ai_count)} foretak vs. ${prior} samme kvartal i fjor`,
                  },
                ];
              }}
            />
          }
        />
        <Bar dataKey="yoy_growth_pct" isAnimationActive={false} radius={[2, 2, 0, 0]}>
          {data.map((d) => (
            <Cell
              key={d.reg_quarter}
              fill={
                d.yoy_growth_pct >= 0
                  ? "var(--color-chart-1)"
                  : "var(--color-destructive)"
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
