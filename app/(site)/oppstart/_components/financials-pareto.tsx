"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
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
import type { BrregSnapshotFinancialsYearly } from "@/lib/supabase";

type Props = {
  rows: BrregSnapshotFinancialsYearly[];
};

const NB = new Intl.NumberFormat("nb-NO");

const chartConfig = {
  ai: { label: "AI-relevante", color: "var(--chart-1)" },
  baseline: { label: "Basislinje", color: "var(--chart-3)" },
  equality: { label: "Perfekt likhet", color: "var(--muted-foreground)" },
} satisfies ChartConfig;

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined) return "—";
  return `${(n * 100).toFixed(digits).replace(".", ",")} %`;
}

function fmtNok(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (Math.abs(n) >= 1_000_000_000) {
    return `${(n / 1_000_000_000).toFixed(1).replace(".", ",")} mrd kr`;
  }
  if (Math.abs(n) >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1).replace(".", ",")} mill kr`;
  }
  return `${NB.format(n)} kr`;
}

export function FinancialsPareto({ rows }: Props) {
  // Years available, ordered desc. Group by fiscal_year.
  const years = useMemo(() => {
    const s = new Set<number>();
    for (const r of rows) s.add(r.fiscal_year);
    return [...s].sort((a, b) => b - a);
  }, [rows]);

  const [selectedYear, setSelectedYear] = useState<number | null>(
    years[0] ?? null,
  );

  const aiRow = useMemo(
    () => rows.find((r) => r.fiscal_year === selectedYear && r.is_ai_relevant),
    [rows, selectedYear],
  );
  const baselineRow = useMemo(
    () => rows.find((r) => r.fiscal_year === selectedYear && !r.is_ai_relevant),
    [rows, selectedYear],
  );

  // Lorenz points → chart-friendly data. We zip the two series (AI + baseline)
  // into a single shape keyed by x for Recharts. Lorenz x values from the two
  // series won't be exactly equal (different n), so we render two
  // independent LineCharts overlaid would normally be cleaner — Recharts
  // accepts both keys per row when nulls fill gaps.
  const chartData = useMemo(() => {
    const aiPts: { x: number; ai: number | null; baseline: number | null }[] =
      (aiRow?.lorenz_points ?? []).map(([x, y]) => ({
        x: Number(x),
        ai: Number(y),
        baseline: null,
      }));
    const baselinePts = (baselineRow?.lorenz_points ?? []).map(([x, y]) => ({
      x: Number(x),
      ai: null,
      baseline: Number(y),
    }));
    return [...aiPts, ...baselinePts].sort((a, b) => a.x - b.x);
  }, [aiRow, baselineRow]);

  if (!aiRow && !baselineRow) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        Ingen finansial data ennå.
      </div>
    );
  }

  const top10 = aiRow?.top10_share ?? null;
  const gini = aiRow?.gini_omsetning ?? null;
  const giniBaseline = baselineRow?.gini_omsetning ?? null;
  const median = aiRow?.median_omsetning ?? null;
  const mean = aiRow?.mean_omsetning ?? null;

  return (
    <div className="flex h-full w-full flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiTile
          label="Topp 10 selskap"
          value={fmtPct(top10)}
          hint="av AI-omsetningen"
        />
        <KpiTile
          label="Gini-koeffisient"
          value={gini !== null ? gini.toFixed(2).replace(".", ",") : "—"}
          hint={
            giniBaseline !== null
              ? `Basislinje: ${giniBaseline.toFixed(2).replace(".", ",")}`
              : "1 = full ulikhet"
          }
        />
        <KpiTile
          label="Median · Snitt"
          value={`${fmtNok(median)} · ${fmtNok(mean)}`}
          hint="Forskjellen viser skjevheten"
        />
      </div>

      <div className="flex items-center justify-end gap-2">
        <label
          htmlFor="pareto-year"
          className="text-xs text-muted-foreground"
        >
          Regnskapsår:
        </label>
        <select
          id="pareto-year"
          value={selectedYear ?? ""}
          onChange={(e) => setSelectedYear(Number(e.target.value))}
          className="rounded-md border bg-background px-2 py-1 text-sm"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      <div className="min-h-0 flex-1">
        <ChartContainer config={chartConfig} className="h-full w-full">
          <LineChart
            data={chartData}
            margin={{ left: 8, right: 8, top: 8, bottom: 0 }}
          >
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="x"
              type="number"
              domain={[0, 1]}
              ticks={[0, 0.25, 0.5, 0.75, 1]}
              tickFormatter={(v) => `${Math.round(Number(v) * 100)} %`}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              label={{
                value: "Andel selskaper (sortert lavest → høyest omsetning)",
                position: "insideBottom",
                offset: -8,
                style: { fontSize: 11, fill: "var(--muted-foreground)" },
              }}
            />
            <YAxis
              domain={[0, 1]}
              ticks={[0, 0.25, 0.5, 0.75, 1]}
              tickFormatter={(v) => `${Math.round(Number(v) * 100)} %`}
              tickLine={false}
              axisLine={false}
              width={48}
              label={{
                value: "Andel omsetning",
                angle: -90,
                position: "insideLeft",
                style: { fontSize: 11, fill: "var(--muted-foreground)" },
              }}
            />
            <ChartTooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={
                <ChartTooltipContent
                  labelFormatter={(label) =>
                    `Topp ${Math.round((1 - Number(label)) * 100)} % største`
                  }
                  formatter={(value, name) => {
                    if (typeof value !== "number") return "—";
                    const label =
                      name === "ai" ? "AI-relevante" : "Basislinje";
                    return `${label}: ${(value * 100).toFixed(1).replace(".", ",")} %`;
                  }}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            {/* 45° equality reference */}
            <ReferenceLine
              segment={[
                { x: 0, y: 0 },
                { x: 1, y: 1 },
              ]}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 4"
              ifOverflow="extendDomain"
            />
            <Line
              dataKey="ai"
              type="linear"
              stroke="var(--color-ai)"
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
            <Line
              dataKey="baseline"
              type="linear"
              stroke="var(--color-baseline)"
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          </LineChart>
        </ChartContainer>
      </div>
    </div>
  );
}

function KpiTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-md border bg-card p-3">
      <p className="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold tabular-nums leading-tight">
        {value}
      </p>
      <p className="mt-0.5 text-[0.7rem] text-muted-foreground">{hint}</p>
    </div>
  );
}
