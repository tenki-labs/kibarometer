"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { StortingMonthly } from "../page";

type Props = {
  rows: StortingMonthly[];
  cutoffMs: number | null;
};

const NB = new Intl.NumberFormat("nb-NO");
const NO_MONTH = new Intl.DateTimeFormat("nb-NO", {
  month: "short",
  year: "numeric",
});

// Aggregates all category rows for a month into a single AI-saker count,
// includes the synthetic '__uncategorized' bucket so the chart axis
// reflects total AI debate volume regardless of Tier 2 progress.
function buildSeries(
  rows: StortingMonthly[],
  cutoffMs: number | null,
): { month: string; total: number; label: string }[] {
  const tally = new Map<string, number>();
  for (const r of rows) {
    const t = new Date(r.computed_for + "T00:00:00Z").getTime();
    if (cutoffMs !== null && t < cutoffMs) continue;
    tally.set(r.computed_for, (tally.get(r.computed_for) ?? 0) + r.ai_count);
  }
  return [...tally.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, total]) => ({
      month,
      total,
      label: NO_MONTH.format(new Date(month + "T00:00:00Z")),
    }));
}

export function DebateVolume({ rows, cutoffMs }: Props) {
  const data = useMemo(() => buildSeries(rows, cutoffMs), [rows, cutoffMs]);

  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Ingen AI-flaggede saker i valgt periode.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 12, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11 }}
          stroke="hsl(var(--muted-foreground))"
        />
        <YAxis
          tick={{ fontSize: 11 }}
          stroke="hsl(var(--muted-foreground))"
          allowDecimals={false}
          width={32}
        />
        <Tooltip
          contentStyle={{
            background: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 6,
            fontSize: 12,
          }}
          formatter={(value: unknown) => [
            `${NB.format(Number(value))} saker`,
            "AI-flagget",
          ]}
          labelFormatter={(label: string) => label}
        />
        <Area
          dataKey="total"
          type="linear"
          stroke="hsl(var(--primary))"
          fill="hsl(var(--primary))"
          fillOpacity={0.18}
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
