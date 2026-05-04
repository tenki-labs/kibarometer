"use client";

import { useMemo, useState } from "react";

import { HBarList } from "@/app/_components/charts";
import {
  AI_COLOR,
  colorForCategory,
  colorForSkillSlug,
} from "@/lib/palette";
import { descriptionFor } from "@/lib/occupation-descriptions";
import type { TaxonomyCategory } from "@/lib/supabase";

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
};

const AI_KEY = "__ai__";
const AI_LABEL = "AI-stillinger";

const NO_DATE_FMT_FULL = new Intl.DateTimeFormat("nb-NO", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});
const NO_DATE_FMT_MONTH = new Intl.DateTimeFormat("nb-NO", {
  month: "long",
  year: "numeric",
});

function formatBucket(bucket: string): string {
  // YYYY-MM-DD or YYYY-MM
  if (bucket.length === 7) {
    return NO_DATE_FMT_MONTH.format(new Date(bucket + "-01T00:00:00Z"));
  }
  return NO_DATE_FMT_FULL.format(new Date(bucket + "T00:00:00Z"));
}

function fmtNumber(n: number): string {
  return n.toLocaleString("nb-NO");
}

function fmtPct(share: number): string {
  return `${(share * 100).toFixed(1).replace(".", ",")} %`;
}

export function StackedArea({ series, aiBandValues, taxonomy, variant }: Props) {
  // Build the visual key order. For occupation variant, AI is the bottom band
  // (rendered first so subsequent bands stack on top).
  const visualKeys = useMemo(() => {
    if (variant === "occupation") return [AI_KEY, ...series.keys];
    if (variant === "skill") {
      // Order skill bands by taxonomy.sort_order (matches /admin/taxonomy).
      const orderBySlug = new Map(taxonomy.map((c) => [c.slug, c.sort_order]));
      return [...series.keys].sort(
        (a, b) => (orderBySlug.get(a) ?? 999) - (orderBySlug.get(b) ?? 999),
      );
    }
    return series.keys;
  }, [series.keys, variant, taxonomy]);

  // For each bucket, build [keyIdx -> value] for visualKeys order.
  const visualValues = useMemo(() => {
    const skillIdxBySlug = new Map(series.keys.map((k, i) => [k, i]));
    return series.dates.map((date, bucketIdx) => {
      return visualKeys.map((vk) => {
        if (vk === AI_KEY) return aiBandValues?.get(date) ?? 0;
        const origIdx = skillIdxBySlug.get(vk) ?? series.keys.indexOf(vk);
        return origIdx >= 0 ? series.values[bucketIdx][origIdx] : 0;
      });
    });
  }, [series, visualKeys, aiBandValues]);

  // Totals per bucket — for share normalization in the 100% stack.
  const totals = useMemo(
    () => visualValues.map((arr) => arr.reduce((a, b) => a + b, 0)),
    [visualValues],
  );

  // Cumulative shares from bottom up: cumul[bucket][keyIdx] = top of band.
  const cumul = useMemo(() => {
    return visualValues.map((arr, bucketIdx) => {
      const total = totals[bucketIdx] || 1;
      let acc = 0;
      return arr.map((v) => {
        acc += v / total;
        return acc;
      });
    });
  }, [visualValues, totals]);

  // Title + description for a visual key.
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
  function bandColor(key: string, idx: number): string {
    if (key === AI_KEY) return AI_COLOR;
    if (variant === "skill") return colorForSkillSlug(key, idx);
    return colorForCategory(key);
  }

  // Empty state.
  if (series.dates.length === 0 || visualKeys.length === 0) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        Ingen data i denne perioden.
      </div>
    );
  }

  // Aggregated rows for the mobile HBarList fallback: sum across all buckets.
  const aggregateRows = visualKeys.map((key, idx) => {
    let v = 0;
    for (let i = 0; i < visualValues.length; i++) v += visualValues[i][idx];
    return { key, value: v };
  });
  const grandTotal = aggregateRows.reduce((a, r) => a + r.value, 0);

  return (
    <>
      {/* Desktop: SVG stacked area */}
      <div className="hidden h-full sm:flex sm:flex-col sm:gap-3">
        <ChartSvg
          dates={series.dates}
          visualKeys={visualKeys}
          visualValues={visualValues}
          cumul={cumul}
          totals={totals}
          bandLabel={bandLabel}
          bandDescription={bandDescription}
          bandColor={bandColor}
        />
      </div>

      {/* Mobile: aggregated horizontal bar list */}
      <div className="sm:hidden">
        <HBarList
          rows={[...aggregateRows]
            .sort((a, b) => b.value - a.value)
            .map((r) => ({
              label: bandLabel(r.key),
              value: r.value,
              total: grandTotal,
            }))}
          lowSampleThreshold={null}
        />
      </div>
    </>
  );
}

// ---------- SVG renderer (client interactivity) ---------------------------

type ChartSvgProps = {
  dates: string[];
  visualKeys: string[];
  visualValues: number[][];
  cumul: number[][];
  totals: number[];
  bandLabel: (key: string) => string;
  bandDescription: (key: string) => string | null;
  bandColor: (key: string, idx: number) => string;
};

function ChartSvg({
  dates,
  visualKeys,
  visualValues,
  cumul,
  totals,
  bandLabel,
  bandDescription,
  bandColor,
}: ChartSvgProps) {
  const VIEW_W = 1000;
  const VIEW_H = 400;
  const [hover, setHover] = useState<{
    keyIdx: number;
    bucketIdx: number;
    xRel: number;
    yRel: number;
    wrapperW: number;
  } | null>(null);

  // Path for band keyIdx — a polygon from bottom share (keyIdx-1) to top share
  // (keyIdx) across all dates.
  function pathFor(keyIdx: number): string {
    const N = dates.length;
    const dx = N > 1 ? VIEW_W / (N - 1) : 0;
    const top: string[] = [];
    const bot: string[] = [];
    for (let i = 0; i < N; i++) {
      const x = N === 1 ? VIEW_W / 2 : i * dx;
      const yTop = VIEW_H - cumul[i][keyIdx] * VIEW_H;
      const yBot = VIEW_H - (keyIdx === 0 ? 0 : cumul[i][keyIdx - 1]) * VIEW_H;
      top.push(`${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${yTop.toFixed(1)}`);
      bot.unshift(`L ${x.toFixed(1)} ${yBot.toFixed(1)}`);
    }
    return [...top, ...bot, "Z"].join(" ");
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const xRel = e.clientX - rect.left;
    const yRel = e.clientY - rect.top;
    const xFrac = xRel / rect.width;
    const yFrac = yRel / rect.height;
    const N = dates.length;
    const bucketIdx = Math.max(0, Math.min(N - 1, Math.round(xFrac * Math.max(N - 1, 1))));
    const share = Math.max(0, Math.min(1, 1 - yFrac));
    const cumulRow = cumul[bucketIdx];
    let keyIdx = cumulRow.findIndex((c) => share <= c);
    if (keyIdx === -1) keyIdx = cumulRow.length - 1;
    setHover({ keyIdx, bucketIdx, xRel, yRel, wrapperW: rect.width });
  }

  function onPointerLeave() {
    setHover(null);
  }

  let tooltip = null;
  if (hover) {
    const key = visualKeys[hover.keyIdx];
    const v = visualValues[hover.bucketIdx][hover.keyIdx];
    const total = totals[hover.bucketIdx] || 0;
    const share = total > 0 ? v / total : 0;
    const placeRight = hover.xRel < hover.wrapperW - 280;
    const desc = bandDescription(key);
    tooltip = (
      <div
        className="pointer-events-none absolute z-10 w-[16rem] rounded-md border bg-popover p-3 text-xs shadow-md"
        style={{
          left: placeRight ? hover.xRel + 12 : hover.xRel - 12 - 256,
          top: Math.max(0, hover.yRel - 60),
        }}
      >
        <div className="text-sm font-medium tracking-tight text-foreground">
          {bandLabel(key)}
        </div>
        <div className="mt-1 font-mono text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
          {formatBucket(dates[hover.bucketIdx])}
        </div>
        <div className="mt-2 tabular-nums">
          {fmtNumber(v)} stillinger · {fmtPct(share)}
        </div>
        {desc ? (
          <p className="mt-2 leading-snug text-muted-foreground">{desc}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className="h-full w-full"
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        role="img"
        aria-label="Stablet arealdiagram over kategorier"
      >
        {visualKeys.map((key, idx) => (
          <path
            key={key}
            d={pathFor(idx)}
            fill={bandColor(key, idx)}
            stroke="rgba(255,255,255,0.5)"
            strokeWidth={0.5}
            opacity={hover && hover.keyIdx !== idx ? 0.65 : 1}
          />
        ))}
      </svg>
      {tooltip}
    </div>
  );
}
