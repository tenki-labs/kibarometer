"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceArea,
  XAxis,
  YAxis,
} from "recharts";

import {
  ChartContainer,
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
  omsetning: { label: "KI-relatert omsetning", color: "var(--chart-1)" },
} satisfies ChartConfig;

type Point = {
  fiscal_year: number;
  omsetning: number;
  company_count: number;
  preliminary: boolean;
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
    const aiRows = rows
      .filter((r) => r.is_ai_relevant)
      .sort((a, b) => a.fiscal_year - b.fiscal_year);
    if (aiRows.length === 0) return [];
    const latest = aiRows[aiRows.length - 1].fiscal_year;
    return aiRows.map((r) => ({
      fiscal_year: r.fiscal_year,
      omsetning: r.sum_omsetning,
      company_count: r.company_count,
      preliminary: r.fiscal_year === latest,
    }));
  }, [rows]);

  if (points.length === 0) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        Ingen finansial data ennå.
      </div>
    );
  }

  const latest = points[points.length - 1];
  const partialFromYear = latest.fiscal_year - 0.5;
  const partialToYear = latest.fiscal_year + 0.5;
  const latestIsPreliminary = latest.fiscal_year === currentYear - 1;

  return (
    <div className="flex h-full w-full flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <KpiTile
          label={`KI-omsetning ${latest.fiscal_year}`}
          value={fmtNok(latest.omsetning)}
          hint={
            latestIsPreliminary
              ? "Foreløpig — innleveringer kommer Jul–Sep"
              : "Sum sum_driftsinntekter"
          }
        />
        <KpiTile
          label={`Antall filere ${latest.fiscal_year}`}
          value={NB.format(latest.company_count)}
          hint="Foretak med positiv omsetning"
        />
      </div>

      <div className="min-h-0 flex-1">
        <ChartContainer config={chartConfig} className="h-full w-full">
          <BarChart
            data={points}
            margin={{ left: 8, right: 8, top: 8, bottom: 0 }}
          >
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="fiscal_year"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(v) => String(v)}
            />
            <YAxis
              tickFormatter={(v) => fmtNok(Number(v))}
              tickLine={false}
              axisLine={false}
              width={72}
            />
            <ChartTooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={
                <ChartTooltipContent
                  labelFormatter={(label) => `Regnskapsår ${label}`}
                  formatter={(value, _name, item) => {
                    if (typeof value !== "number") return "—";
                    const p = item.payload as Point;
                    return `${fmtNok(value)} · ${NB.format(p.company_count)} filere`;
                  }}
                />
              }
            />
            {latestIsPreliminary ? (
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
            <Bar
              dataKey="omsetning"
              fill="var(--color-omsetning)"
              isAnimationActive={false}
              radius={[4, 4, 0, 0]}
            >
              {points.map((p) => (
                <Cell
                  key={p.fiscal_year}
                  fill="var(--color-omsetning)"
                  fillOpacity={p.preliminary && latestIsPreliminary ? 0.55 : 1}
                />
              ))}
            </Bar>
          </BarChart>
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
