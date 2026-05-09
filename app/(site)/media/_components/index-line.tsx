"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { MediaSnapshotIndex } from "@/lib/supabase";

import {
  formatBucket,
  formatBucketShort,
} from "@/app/(site)/_components/bucket-format";

type Props = {
  rows: MediaSnapshotIndex[];
  cutoffMs: number | null;
  monthly: boolean;
};

const PLOT_MARGIN = { top: 12, right: 12, bottom: 0, left: 8 };
const X_AXIS_HEIGHT = 30;

const chartConfig = {
  index: {
    label: "Kibarometer-indeks",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

function indexLabel(value: number): string {
  if (value >= 65) return "Begeistret tilt";
  if (value >= 55) return "Lett positiv";
  if (value >= 45) return "Balansert";
  if (value >= 35) return "Lett negativ";
  return "Bekymret tilt";
}

export function IndexLine({ rows, cutoffMs, monthly }: Props) {
  // Aggregate rows into daily/monthly buckets and average the index value per
  // bucket. Same logic as the old IndexBar — only the chart shape changes.
  const data = useMemo(() => {
    const cutoff = cutoffMs ?? -Infinity;
    const buckets = new Map<string, { sum: number; n: number }>();
    for (const row of rows) {
      const t = new Date(row.date + "T00:00:00Z").getTime();
      if (t < cutoff) continue;
      const key = monthly ? row.date.slice(0, 7) : row.date.slice(0, 10);
      const cur = buckets.get(key) ?? { sum: 0, n: 0 };
      cur.sum += row.index_value;
      cur.n += 1;
      buckets.set(key, cur);
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({
        date,
        index: Math.round(v.sum / Math.max(1, v.n)),
      }));
  }, [rows, cutoffMs, monthly]);

  // Track the chart's pixel height so the thermometer gradient maps to the
  // absolute 0–100 plot area, not the line's bounding box. A line hovering at
  // index ≈ 30 should still look blue regardless of whether the visible range
  // ever climbs to 100.
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerHeight(el.clientHeight);
    const ro = new ResizeObserver(([entry]) => {
      setContainerHeight(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (data.length === 0) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        Ingen data i denne perioden.
      </div>
    );
  }

  const plotTop = PLOT_MARGIN.top;
  const plotBottom = Math.max(
    plotTop + 1,
    containerHeight - PLOT_MARGIN.bottom - X_AXIS_HEIGHT,
  );

  return (
    <div ref={containerRef} className="h-full w-full">
      <ChartContainer config={chartConfig} className="h-full w-full">
        <LineChart data={data} margin={PLOT_MARGIN}>
          <defs>
            <linearGradient
              id="kiba-thermo"
              gradientUnits="userSpaceOnUse"
              x1="0"
              y1={plotTop}
              x2="0"
              y2={plotBottom}
            >
              <stop offset="0%" stopColor="oklch(0.62 0.22 25)" />
              <stop offset="50%" stopColor="oklch(0.7 0.02 250)" />
              <stop offset="100%" stopColor="oklch(0.55 0.18 250)" />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={32}
            height={X_AXIS_HEIGHT}
            tickFormatter={formatBucketShort}
          />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tickLine={false}
            axisLine={false}
            width={28}
          />
          <ReferenceLine
            y={50}
            stroke="var(--border)"
            strokeDasharray="4 4"
            ifOverflow="visible"
          />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                indicator="dot"
                labelFormatter={(value) =>
                  typeof value === "string"
                    ? formatBucket(value)
                    : String(value)
                }
                formatter={(value) => {
                  const numeric =
                    typeof value === "number" ? value : Number(value) || 0;
                  return (
                    <div className="flex w-full flex-col gap-1">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">Indeks</span>
                        <span className="font-mono font-medium tabular-nums text-foreground">
                          {numeric}
                        </span>
                      </div>
                      <span className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
                        {indexLabel(numeric)} (50 = balansert)
                      </span>
                    </div>
                  );
                }}
              />
            }
          />
          <Line
            dataKey="index"
            type="monotone"
            stroke="url(#kiba-thermo)"
            strokeWidth={2.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ChartContainer>
    </div>
  );
}
