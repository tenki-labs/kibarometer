"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
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
} satisfies ChartConfig;

type Point = {
  fiscal_year: number;
  ai: number | null;
  baseline: number | null;
  aiNok: number | null;
  baselineNok: number | null;
};

function fmtNok(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (Math.abs(n) >= 1_000_000_000_000) {
    return `${(n / 1_000_000_000_000).toFixed(2).replace(".", ",")} bill kr`;
  }
  if (Math.abs(n) >= 1_000_000_000) {
    return `${(n / 1_000_000_000).toFixed(1).replace(".", ",")} mrd kr`;
  }
  if (Math.abs(n) >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(0)} mill kr`;
  }
  return `${NB.format(n)} kr`;
}

export function FinancialsGrowth({ rows }: Props) {
  // Calendar year captured once at mount via lazy useState so render
  // stays pure (matches the pattern in scroller.tsx's heroStale).
  const [currentYear] = useState(() => new Date().getFullYear());

  const points = useMemo<Point[]>(() => {
    const byYear = new Map<number, { ai: number | null; baseline: number | null }>();
    for (const r of rows) {
      const cur = byYear.get(r.fiscal_year) ?? { ai: null, baseline: null };
      if (r.is_ai_relevant) cur.ai = r.sum_omsetning;
      else cur.baseline = r.sum_omsetning;
      byYear.set(r.fiscal_year, cur);
    }
    const sorted = [...byYear.entries()].sort(([a], [b]) => a - b);
    if (sorted.length === 0) return [];

    // Index to 100 at the first year where both series have data.
    const baseYear = sorted.find(([, v]) => v.ai !== null && v.baseline !== null);
    if (!baseYear) {
      // Fallback: just index AI to its first available year. Baseline left as raw.
      return sorted.map(([y, v]) => ({
        fiscal_year: y,
        ai: null,
        baseline: null,
        aiNok: v.ai,
        baselineNok: v.baseline,
      }));
    }
    const [, baseVals] = baseYear;
    const baseAi = baseVals.ai ?? 1;
    const baseBaseline = baseVals.baseline ?? 1;
    return sorted.map(([y, v]) => ({
      fiscal_year: y,
      ai: v.ai !== null ? Math.round((v.ai / baseAi) * 100) : null,
      baseline:
        v.baseline !== null ? Math.round((v.baseline / baseBaseline) * 100) : null,
      aiNok: v.ai,
      baselineNok: v.baseline,
    }));
  }, [rows]);

  // Latest year is "preliminary": filings land Jul-Sep so a year ending in
  // 2024 wouldn't be complete until late 2025. Render its area as a
  // shaded reference area so readers see the year is not fully filed.
  const latestYear = points.length > 0 ? points[points.length - 1].fiscal_year : null;
  const partialFromYear = latestYear !== null ? latestYear - 0.5 : null;
  const partialToYear = latestYear !== null ? latestYear + 0.5 : null;

  if (points.length === 0) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        Ingen finansial data ennå.
      </div>
    );
  }

  // KPIs: latest year sum (AI), growth since 2020, growth gap pp.
  const latest = points[points.length - 1];
  const since2020 = points.find((p) => p.fiscal_year === 2020) ?? points[0];
  const aiGrowth =
    latest.ai !== null && since2020.ai !== null
      ? ((latest.ai - since2020.ai) / since2020.ai) * 100
      : null;
  const baselineGrowth =
    latest.baseline !== null && since2020.baseline !== null
      ? ((latest.baseline - since2020.baseline) / since2020.baseline) * 100
      : null;
  const gapPP =
    aiGrowth !== null && baselineGrowth !== null
      ? aiGrowth - baselineGrowth
      : null;

  function fmtGrowth(p: number | null): string {
    if (p === null) return "—";
    return `${p >= 0 ? "+" : ""}${p.toFixed(0)} %`;
  }

  return (
    <div className="flex h-full w-full flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiTile
          label={`AI-sektor omsetning ${latest.fiscal_year}`}
          value={fmtNok(latest.aiNok)}
          hint={
            latestYear === currentYear - 1
              ? "Foreløpig — innleveringer kommer Jul–Sep"
              : "Sum sum_driftsinntekter"
          }
        />
        <KpiTile
          label="Vekst fra 2020"
          value={`AI ${fmtGrowth(aiGrowth)} · basislinje ${fmtGrowth(baselineGrowth)}`}
          hint="Indeksert til 100 i basisåret"
        />
        <KpiTile
          label="Gap"
          value={
            gapPP !== null
              ? `${gapPP >= 0 ? "+" : ""}${gapPP.toFixed(0)} pp`
              : "—"
          }
          hint={
            gapPP !== null && gapPP >= 0
              ? "AI vokser raskere"
              : "AI vokser saktere"
          }
        />
      </div>

      <div className="min-h-0 flex-1">
        <ChartContainer config={chartConfig} className="h-full w-full">
          <LineChart
            data={points}
            margin={{ left: 8, right: 8, top: 8, bottom: 0 }}
          >
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="fiscal_year"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(v) => String(v)}
              allowDecimals={false}
            />
            <YAxis
              tickFormatter={(v) => String(v)}
              tickLine={false}
              axisLine={false}
              width={40}
              label={{
                value: "Indeks (basisår = 100)",
                angle: -90,
                position: "insideLeft",
                style: { fontSize: 11, fill: "var(--muted-foreground)" },
              }}
            />
            <ChartTooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={
                <ChartTooltipContent
                  labelFormatter={(label) => `Regnskapsår ${label}`}
                  formatter={(value, name, item) => {
                    if (typeof value !== "number") return "—";
                    const label =
                      name === "ai" ? "AI-relevante" : "Basislinje";
                    const raw =
                      name === "ai"
                        ? (item.payload as Point).aiNok
                        : (item.payload as Point).baselineNok;
                    return `${label}: ${value} (${fmtNok(raw)})`;
                  }}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            {partialFromYear !== null && partialToYear !== null ? (
              <ReferenceArea
                x1={partialFromYear}
                x2={partialToYear}
                fill="var(--muted)"
                fillOpacity={0.3}
                ifOverflow="visible"
                label={{
                  value: "foreløpig",
                  position: "insideTop",
                  fontSize: 10,
                  fill: "var(--muted-foreground)",
                }}
              />
            ) : null}
            <Line
              dataKey="ai"
              type="linear"
              stroke="var(--color-ai)"
              strokeWidth={2}
              dot
              connectNulls
              isAnimationActive={false}
            />
            <Line
              dataKey="baseline"
              type="linear"
              stroke="var(--color-baseline)"
              strokeWidth={2}
              dot
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
