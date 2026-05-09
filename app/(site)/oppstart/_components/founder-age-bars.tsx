"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  XAxis,
  YAxis,
} from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { BrregSnapshotFounderAgeYearly } from "@/lib/supabase";

type Props = {
  rows: BrregSnapshotFounderAgeYearly[];
};

type Point = {
  year: number;
  aiMedian: number | null;
  nonAiMedian: number | null;
  aiP25: number | null;
  aiP75: number | null;
  nonAiP25: number | null;
  nonAiP75: number | null;
  aiSample: number;
  nonAiSample: number;
};

const NB = new Intl.NumberFormat("nb-NO");
const SAMPLE_FLOOR = 25;

const chartConfig = {
  aiMedian: { label: "AI-relevante", color: "var(--chart-1)" },
  nonAiMedian: { label: "Ikke-AI", color: "var(--chart-3)" },
} satisfies ChartConfig;

function fmtAge(v: number | null): string {
  if (v === null) return "—";
  return v.toFixed(1).replace(".", ",") + " år";
}

export function FounderAgeBars({ rows }: Props) {
  const points = useMemo<Point[]>(() => {
    const byYear = new Map<number, Point>();
    for (const r of rows) {
      const cur =
        byYear.get(r.reg_year) ??
        ({
          year: r.reg_year,
          aiMedian: null,
          nonAiMedian: null,
          aiP25: null,
          aiP75: null,
          nonAiP25: null,
          nonAiP75: null,
          aiSample: 0,
          nonAiSample: 0,
        } as Point);
      if (r.is_ai_relevant) {
        cur.aiMedian = r.median_youngest_age;
        cur.aiP25 = r.p25_youngest_age;
        cur.aiP75 = r.p75_youngest_age;
        cur.aiSample = r.sample_size;
      } else {
        cur.nonAiMedian = r.median_youngest_age;
        cur.nonAiP25 = r.p25_youngest_age;
        cur.nonAiP75 = r.p75_youngest_age;
        cur.nonAiSample = r.sample_size;
      }
      byYear.set(r.reg_year, cur);
    }
    return [...byYear.values()].sort((a, b) => a.year - b.year);
  }, [rows]);

  if (points.length === 0) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        Ingen grunnlegger-data ennå.
      </div>
    );
  }

  // Auto Y-domain. Floor at 0, but pad both ends for breathing room.
  const allAges = points.flatMap((p) =>
    [p.aiMedian, p.nonAiMedian, p.aiP25, p.aiP75, p.nonAiP25, p.nonAiP75].filter(
      (v): v is number => v != null,
    ),
  );
  const minAge = Math.max(0, Math.floor(Math.min(...allAges, 100) / 5) * 5 - 5);
  const maxAge = Math.ceil(Math.max(...allAges, 0) / 5) * 5 + 5;

  return (
    <ChartContainer config={chartConfig} className="h-full w-full">
      <BarChart data={points} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="year"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={16}
        />
        <YAxis
          domain={[minAge, maxAge]}
          tickFormatter={(v) => `${v}`}
          tickLine={false}
          axisLine={false}
          width={36}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              indicator="dot"
              formatter={(value, name, item) => {
                const key = String(name);
                const p = item.payload as Point;
                const isAi = key === "aiMedian";
                const median =
                  typeof value === "number" ? value : Number(value) || null;
                const p25 = isAi ? p.aiP25 : p.nonAiP25;
                const p75 = isAi ? p.aiP75 : p.nonAiP75;
                const sample = isAi ? p.aiSample : p.nonAiSample;
                const label = isAi ? "AI-relevante" : "Ikke-AI";
                const lowSample = sample < SAMPLE_FLOOR;
                return (
                  <div className="flex w-full flex-col gap-1">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-mono font-medium tabular-nums text-foreground">
                        {fmtAge(median)}
                      </span>
                    </div>
                    {p25 !== null && p75 !== null ? (
                      <span className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
                        IQR {fmtAge(p25)} – {fmtAge(p75)}
                      </span>
                    ) : null}
                    <span
                      className={
                        "font-mono text-[0.65rem] uppercase tracking-[0.16em] " +
                        (lowSample
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-muted-foreground")
                      }
                    >
                      n = {NB.format(sample)}
                      {lowSample ? " · lavt utvalg" : ""}
                    </span>
                  </div>
                );
              }}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar
          dataKey="aiMedian"
          fill="var(--color-aiMedian)"
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
        >
          {points.map((p) => (
            <Cell
              key={`ai-${p.year}`}
              fillOpacity={p.aiSample < SAMPLE_FLOOR ? 0.45 : 1}
            />
          ))}
        </Bar>
        <Bar
          dataKey="nonAiMedian"
          fill="var(--color-nonAiMedian)"
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
        >
          {points.map((p) => (
            <Cell
              key={`nonai-${p.year}`}
              fillOpacity={p.nonAiSample < SAMPLE_FLOOR ? 0.45 : 1}
            />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
