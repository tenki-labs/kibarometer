"use client";

import { useMemo, useState } from "react";

import { AI_COLOR } from "@/lib/palette";
import type { MediaSnapshotIndex } from "@/lib/supabase";

type Props = {
  rows: MediaSnapshotIndex[];
  cutoffMs: number | null;
  monthly: boolean;
};

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
  if (bucket.length === 7) {
    return NO_DATE_FMT_MONTH.format(new Date(bucket + "-01T00:00:00Z"));
  }
  return NO_DATE_FMT_FULL.format(new Date(bucket + "T00:00:00Z"));
}

type Point = { date: string; value: number };

export function IndexLine({ rows, cutoffMs, monthly }: Props) {
  const points = useMemo<Point[]>(() => {
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
      .map(([date, v]) => ({ date, value: v.sum / Math.max(1, v.n) }));
  }, [rows, cutoffMs, monthly]);

  if (points.length === 0) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        Ingen data i denne perioden.
      </div>
    );
  }

  return <LineSvg points={points} />;
}

function LineSvg({ points }: { points: Point[] }) {
  const VIEW_W = 1000;
  const VIEW_H = 400;
  const Y_MIN = 0;
  const Y_MAX = 100;

  const N = points.length;
  const dx = N > 1 ? VIEW_W / (N - 1) : 0;

  function xAt(i: number): number {
    return N === 1 ? VIEW_W / 2 : i * dx;
  }
  function yAt(v: number): number {
    return VIEW_H - ((v - Y_MIN) / (Y_MAX - Y_MIN)) * VIEW_H;
  }

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(p.value).toFixed(1)}`)
    .join(" ");

  // Area under the line (filled lightly).
  const areaPath = (() => {
    const top = points.map(
      (p, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(p.value).toFixed(1)}`,
    );
    return [
      ...top,
      `L ${xAt(N - 1).toFixed(1)} ${VIEW_H}`,
      `L ${xAt(0).toFixed(1)} ${VIEW_H}`,
      "Z",
    ].join(" ");
  })();

  const baselineY = yAt(50);

  const [hover, setHover] = useState<{
    idx: number;
    xRel: number;
    yRel: number;
    wrapperW: number;
  } | null>(null);

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const xRel = e.clientX - rect.left;
    const yRel = e.clientY - rect.top;
    const xFrac = xRel / rect.width;
    const idx = Math.max(0, Math.min(N - 1, Math.round(xFrac * Math.max(N - 1, 1))));
    setHover({ idx, xRel, yRel, wrapperW: rect.width });
  }
  function onPointerLeave() {
    setHover(null);
  }

  let tooltip = null;
  if (hover) {
    const p = points[hover.idx];
    const placeRight = hover.xRel < hover.wrapperW - 220;
    tooltip = (
      <div
        className="pointer-events-none absolute z-10 w-[12rem] rounded-md border bg-popover p-3 text-xs shadow-md"
        style={{
          left: placeRight ? hover.xRel + 12 : hover.xRel - 12 - 192,
          top: Math.max(0, hover.yRel - 60),
        }}
      >
        <div className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
          {formatBucket(p.date)}
        </div>
        <div className="mt-2 text-2xl font-medium tabular-nums">
          {p.value.toFixed(0)}
        </div>
        <p className="mt-1 leading-snug text-muted-foreground">
          0–100 indeks · 50 = balansert
        </p>
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
        aria-label="Linje­diagram for kibarometer-indeks over tid"
      >
        <line
          x1={0}
          y1={baselineY}
          x2={VIEW_W}
          y2={baselineY}
          stroke="currentColor"
          strokeOpacity={0.18}
          strokeWidth={1}
          strokeDasharray="4 4"
        />
        <path d={areaPath} fill={AI_COLOR} fillOpacity={0.12} />
        <path d={linePath} fill="none" stroke={AI_COLOR} strokeWidth={2} />
        {hover ? (
          <circle
            cx={xAt(hover.idx)}
            cy={yAt(points[hover.idx].value)}
            r={5}
            fill={AI_COLOR}
            stroke="white"
            strokeWidth={2}
          />
        ) : null}
      </svg>
      {tooltip}
    </div>
  );
}
