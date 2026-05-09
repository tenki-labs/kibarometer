"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
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
import { AI_COLOR } from "@/lib/palette";
import { descriptionFor } from "@/lib/occupation-descriptions";
import type { TaxonomyCategory } from "@/lib/supabase";

import { formatBucket, formatBucketShort } from "./bucket-format";

export type Series = {
  dates: string[];
  keys: string[];
  values: number[][]; // values[bucket][keyIdx]
};

type Variant = "occupation" | "skill";

type Props = {
  series: Series;
  /** Synthetic AI band values keyed by date bucket. Only used when
   * variant === "occupation" (the AI band layers at the bottom). */
  aiBandValues?: Map<string, number>;
  taxonomy: TaxonomyCategory[];
  variant: Variant;
  /** When true, each bucket is normalised to fill 100 % of the chart height —
   *  bands show the share of the bucket rather than absolute counts. */
  normalize?: boolean;
};

const AI_KEY = "__ai__";
const AI_LABEL = "AI-stillinger";

export function StackedAreaChart({
  series,
  aiBandValues,
  taxonomy,
  variant,
  normalize = false,
}: Props) {
  // Visual key order: AI band first (bottom of stack) for occupation, taxonomy
  // sort order for skill, fallback to natural order otherwise.
  const visualKeys = useMemo<string[]>(() => {
    if (variant === "occupation" && aiBandValues) {
      return [AI_KEY, ...series.keys];
    }
    if (variant === "skill") {
      const orderBySlug = new Map(taxonomy.map((c) => [c.slug, c.sort_order]));
      return [...series.keys].sort(
        (a, b) => (orderBySlug.get(a) ?? 999) - (orderBySlug.get(b) ?? 999),
      );
    }
    return series.keys;
  }, [series.keys, variant, taxonomy, aiBandValues]);

  // Pivot values[bucket][keyIdx] into row-of-objects shape Recharts expects:
  // [{ date: '2026-04-01', __ai__: 12, accountant: 5, ... }, ...]
  const data = useMemo(() => {
    const skillIdxBySlug = new Map(series.keys.map((k, i) => [k, i]));
    return series.dates.map((date, bucketIdx) => {
      const row: Record<string, string | number> = { date };
      for (const vk of visualKeys) {
        if (vk === AI_KEY) {
          row[vk] = aiBandValues?.get(date) ?? 0;
        } else {
          const origIdx = skillIdxBySlug.get(vk) ?? -1;
          row[vk] = origIdx >= 0 ? series.values[bucketIdx][origIdx] : 0;
        }
      }
      return row;
    });
  }, [series, visualKeys, aiBandValues]);

  const titleBySlug = useMemo(
    () => new Map(taxonomy.map((c) => [c.slug, c.title])),
    [taxonomy],
  );

  function bandLabel(key: string): string {
    if (key === AI_KEY) return AI_LABEL;
    if (variant === "skill") return titleBySlug.get(key) ?? key;
    return key;
  }

  function bandDescription(key: string): string | null {
    if (key === AI_KEY) {
      return "Alle stillinger der NAV-feeden inneholder AI-relaterte nøkkelord. Vises som eget bånd nederst i grafen.";
    }
    if (variant === "skill") {
      const c = taxonomy.find((t) => t.slug === key);
      return c?.definition_md ?? null;
    }
    return descriptionFor(key);
  }

  function colorForKey(key: string, idx: number): string {
    if (key === AI_KEY) return AI_COLOR;
    // chart-1..12 rotation
    const slot = (idx % 12) + 1;
    return `var(--chart-${slot})`;
  }

  const chartConfig = useMemo<ChartConfig>(() => {
    const config: ChartConfig = {};
    visualKeys.forEach((key, idx) => {
      config[key] = {
        label: bandLabel(key),
        color: colorForKey(key, idx),
      };
    });
    return config;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visualKeys, taxonomy]);

  if (series.dates.length === 0 || visualKeys.length === 0) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        Ingen data i denne perioden.
      </div>
    );
  }

  return (
    <ChartContainer config={chartConfig} className="h-full w-full">
      <AreaChart
        data={data}
        margin={{ left: 8, right: 8, top: 8, bottom: 0 }}
        stackOffset={normalize ? "expand" : undefined}
      >
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={32}
          tickFormatter={formatBucketShort}
        />
        {normalize ? (
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={4}
            width={36}
            domain={[0, 1]}
            ticks={[0, 0.25, 0.5, 0.75, 1]}
            tickFormatter={(v) => `${Math.round((v as number) * 100)} %`}
          />
        ) : (
          <YAxis hide />
        )}
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              indicator="dot"
              labelFormatter={(value) =>
                typeof value === "string" ? formatBucket(value) : String(value)
              }
              formatter={(value, name, item) => {
                const key = String(name);
                const numeric = typeof value === "number" ? value : Number(value) || 0;
                const total = (() => {
                  const p = item.payload as Record<string, number> | undefined;
                  if (!p) return 0;
                  let sum = 0;
                  for (const k of visualKeys) sum += Number(p[k] ?? 0);
                  return sum;
                })();
                const share = total > 0 ? numeric / total : 0;
                const desc = bandDescription(key);
                return (
                  <div className="flex w-full flex-col gap-1">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">
                        {bandLabel(key)}
                      </span>
                      <span className="font-mono font-medium tabular-nums text-foreground">
                        {numeric.toLocaleString("nb-NO")}
                      </span>
                    </div>
                    <span className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
                      {(share * 100).toFixed(1).replace(".", ",")} % av dagen
                    </span>
                    {desc ? (
                      <p className="mt-1 max-w-[18rem] text-[0.7rem] leading-snug text-muted-foreground">
                        {desc}
                      </p>
                    ) : null}
                  </div>
                );
              }}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        {visualKeys.map((key) => (
          <Area
            key={key}
            dataKey={key}
            type="monotone"
            stackId="a"
            stroke={`var(--color-${key})`}
            fill={`var(--color-${key})`}
            fillOpacity={0.7}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ChartContainer>
  );
}
