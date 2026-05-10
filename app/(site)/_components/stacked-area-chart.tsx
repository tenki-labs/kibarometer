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
  type ChartConfig,
} from "@/components/ui/chart";
import { AI_COLOR } from "@/lib/palette";
import type { TaxonomyCategory } from "@/lib/supabase";

import { formatBucket, formatBucketShort } from "./bucket-format";
import { ChartHoverPanel, type ChartHoverRow } from "./chart-hover-panel";
import { useChartInteraction } from "./use-chart-interaction";

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
  const { activeKey, setActiveKey, tooltipTrigger } = useChartInteraction();

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

  // 100 %-stacked area with <3 X points renders as a triangular wedge under
  // recharts' linear interpolation, which reads as a misleading trend.
  // Show an explicit empty-state instead.
  if (normalize && series.dates.length < 3) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-md border border-dashed px-6 text-center text-sm text-muted-foreground">
        For lite data til å vise andeler i denne perioden. Velg en kortere
        tidsintervall, eller vent til datagrunnlaget bygger seg opp.
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
          trigger={tooltipTrigger}
          cursor={{ strokeDasharray: "3 3" }}
          content={
            <ChartHoverPanel
              mode="stacked"
              activeKey={activeKey}
              header={(label) =>
                typeof label === "string" ? formatBucket(label) : String(label)
              }
              rows={(payload) => {
                if (!payload?.length) return [];
                const row = payload[0]?.payload as
                  | Record<string, number>
                  | undefined;
                let total = 0;
                if (row) {
                  for (const k of visualKeys) total += Number(row[k] ?? 0);
                }
                return payload
                  .map((item): ChartHoverRow | null => {
                    const key = String(item.dataKey ?? item.name ?? "");
                    if (!key) return null;
                    const numeric =
                      typeof item.value === "number"
                        ? item.value
                        : Number(item.value) || 0;
                    const share = total > 0 ? numeric / total : 0;
                    return {
                      key,
                      label: bandLabel(key),
                      color: item.color,
                      value: numeric.toLocaleString("nb-NO"),
                      sub: `${(share * 100)
                        .toFixed(1)
                        .replace(".", ",")} % av dagen`,
                    };
                  })
                  .filter((r): r is ChartHoverRow => r !== null);
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
            onMouseEnter={() => setActiveKey(key)}
            onMouseLeave={() => setActiveKey(undefined)}
            onClick={() => setActiveKey(key)}
          />
        ))}
      </AreaChart>
    </ChartContainer>
  );
}
