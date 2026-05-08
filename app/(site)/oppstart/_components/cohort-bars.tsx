"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
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
import type { BrregSnapshotCohort } from "@/lib/supabase";

type Props = {
  rows: BrregSnapshotCohort[];
};

const NB = new Intl.NumberFormat("nb-NO");

function quarterLabel(iso: string): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${y} Q${q}`;
}

type LinePoint = {
  quarter: string;
  ai: number | null;
  nonAi: number | null;
  aiTotal: number;
  nonAiTotal: number;
};

const chartConfig = {
  ai: {
    label: "AI-relevante",
    color: "var(--chart-1)",
  },
  nonAi: {
    label: "Ikke-AI",
    color: "var(--chart-3)",
  },
} satisfies ChartConfig;

export function CohortBars({ rows }: Props) {
  const points = useMemo<LinePoint[]>(() => {
    const byQuarter = new Map<string, LinePoint>();
    for (const r of rows) {
      const q = quarterLabel(r.cohort_quarter);
      const cur =
        byQuarter.get(q) ??
        ({
          quarter: q,
          ai: null,
          nonAi: null,
          aiTotal: 0,
          nonAiTotal: 0,
        } as LinePoint);
      if (r.is_ai_relevant) {
        cur.ai = r.survival_rate_pct;
        cur.aiTotal = r.total_at_registration;
      } else {
        cur.nonAi = r.survival_rate_pct;
        cur.nonAiTotal = r.total_at_registration;
      }
      byQuarter.set(q, cur);
    }
    return [...byQuarter.values()].sort((a, b) =>
      a.quarter.localeCompare(b.quarter),
    );
  }, [rows]);

  if (points.length === 0) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        Ingen kohort-data ennå.
      </div>
    );
  }

  // Few cohorts → fall back to a compact summary table instead of a thin chart.
  if (points.length < 4) {
    return <CompactTable points={points} />;
  }

  // Auto Y range floored at 70% so small differences pop.
  const allRates = points.flatMap((p) =>
    [p.ai, p.nonAi].filter((r): r is number => r != null),
  );
  const minRate = Math.min(70, Math.floor(Math.min(...allRates, 100) / 5) * 5);

  return (
    <ChartContainer config={chartConfig} className="h-full w-full">
      <BarChart data={points} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="quarter"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={16}
        />
        <YAxis
          domain={[minRate, 100]}
          tickFormatter={(v) => `${v}%`}
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
                const numeric = typeof value === "number" ? value : Number(value) || 0;
                const key = String(name);
                const payload = item.payload as LinePoint | undefined;
                const total =
                  key === "ai" ? payload?.aiTotal : payload?.nonAiTotal;
                const label = key === "ai" ? "AI-relevante" : "Ikke-AI";
                return (
                  <div className="flex w-full flex-col gap-1">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-mono font-medium tabular-nums text-foreground">
                        {numeric.toFixed(1).replace(".", ",")} %
                      </span>
                    </div>
                    {total ? (
                      <span className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
                        {NB.format(total)} foretak ved registrering
                      </span>
                    ) : null}
                  </div>
                );
              }}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar
          dataKey="ai"
          fill="var(--color-ai)"
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
        />
        <Bar
          dataKey="nonAi"
          fill="var(--color-nonAi)"
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
        />
      </BarChart>
    </ChartContainer>
  );
}

function CompactTable({ points }: { points: LinePoint[] }) {
  return (
    <div className="flex h-full flex-col">
      <div className="grid grid-cols-[8rem_1fr_1fr] gap-3 border-b pb-2 font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
        <span>Kvartal</span>
        <span>AI-relevante</span>
        <span>Ikke-AI</span>
      </div>
      <ul className="flex flex-col">
        {points.map((p) => (
          <li
            key={p.quarter}
            className="grid grid-cols-[8rem_1fr_1fr] items-center gap-3 border-b py-3 text-sm"
          >
            <span className="font-mono text-xs">{p.quarter}</span>
            <span className="tabular-nums">
              {p.ai !== null ? `${p.ai.toFixed(1).replace(".", ",")} %` : "—"}
              {p.aiTotal ? (
                <span className="ml-2 font-mono text-[0.65rem] text-muted-foreground">
                  {NB.format(p.aiTotal)} foretak
                </span>
              ) : null}
            </span>
            <span className="tabular-nums">
              {p.nonAi !== null
                ? `${p.nonAi.toFixed(1).replace(".", ",")} %`
                : "—"}
              {p.nonAiTotal ? (
                <span className="ml-2 font-mono text-[0.65rem] text-muted-foreground">
                  {NB.format(p.nonAiTotal)} foretak
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
