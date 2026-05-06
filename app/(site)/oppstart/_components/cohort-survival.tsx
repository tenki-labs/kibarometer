"use client";

import { useMemo, useState } from "react";

import { AI_COLOR } from "@/lib/palette";
import type { BrregSnapshotCohort } from "@/lib/supabase";

type Props = {
  rows: BrregSnapshotCohort[];
};

const NB = new Intl.NumberFormat("nb-NO");
const NON_AI_COLOR = "oklch(0.55 0.04 250)";

function quarterLabel(iso: string): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${y} Q${q}`;
}

type LinePoint = {
  quarter: string;
  ai: { rate: number; total: number } | null;
  nonAi: { rate: number; total: number } | null;
};

export function CohortSurvival({ rows }: Props) {
  const points = useMemo<LinePoint[]>(() => {
    const byQuarter = new Map<string, LinePoint>();
    for (const r of rows) {
      const q = quarterLabel(r.cohort_quarter);
      const cur = byQuarter.get(q) ?? { quarter: q, ai: null, nonAi: null };
      const slot = { rate: r.survival_rate_pct, total: r.total_at_registration };
      if (r.is_ai_relevant) cur.ai = slot;
      else cur.nonAi = slot;
      byQuarter.set(q, cur);
    }
    return [...byQuarter.values()].sort((a, b) => a.quarter.localeCompare(b.quarter));
  }, [rows]);

  if (points.length === 0) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        Ingen kohort-data ennå.
      </div>
    );
  }

  // Few cohorts → fall back to a compact table-style summary instead of a thin chart.
  if (points.length < 4) {
    return <CompactTable points={points} />;
  }

  return <DualLineSvg points={points} />;
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
              {p.ai
                ? `${p.ai.rate.toFixed(1).replace(".", ",")} %`
                : "—"}
              {p.ai ? (
                <span className="ml-2 font-mono text-[0.65rem] text-muted-foreground">
                  {NB.format(p.ai.total)} foretak
                </span>
              ) : null}
            </span>
            <span className="tabular-nums">
              {p.nonAi
                ? `${p.nonAi.rate.toFixed(1).replace(".", ",")} %`
                : "—"}
              {p.nonAi ? (
                <span className="ml-2 font-mono text-[0.65rem] text-muted-foreground">
                  {NB.format(p.nonAi.total)} foretak
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DualLineSvg({ points }: { points: LinePoint[] }) {
  const VIEW_W = 1000;
  const VIEW_H = 400;

  const N = points.length;
  const dx = N > 1 ? VIEW_W / (N - 1) : 0;

  // Auto-scale Y to the data, but never tighter than 70..100% so small differences pop.
  const allRates = points.flatMap((p) => [p.ai?.rate, p.nonAi?.rate].filter((r): r is number => r != null));
  const minRate = Math.min(70, Math.floor(Math.min(...allRates, 100) / 5) * 5);
  const maxRate = 100;

  function xAt(i: number): number {
    return N === 1 ? VIEW_W / 2 : i * dx;
  }
  function yAt(rate: number): number {
    return VIEW_H - ((rate - minRate) / (maxRate - minRate)) * VIEW_H;
  }

  function pathFor(getRate: (p: LinePoint) => number | null): string {
    let started = false;
    const out: string[] = [];
    for (let i = 0; i < N; i++) {
      const r = getRate(points[i]);
      if (r === null || !Number.isFinite(r)) continue;
      const cmd = started ? "L" : "M";
      out.push(`${cmd} ${xAt(i).toFixed(1)} ${yAt(r).toFixed(1)}`);
      started = true;
    }
    return out.join(" ");
  }

  const aiPath = pathFor((p) => p.ai?.rate ?? null);
  const nonAiPath = pathFor((p) => p.nonAi?.rate ?? null);

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
    const placeRight = hover.xRel < hover.wrapperW - 240;
    tooltip = (
      <div
        className="pointer-events-none absolute z-10 w-[14rem] rounded-md border bg-popover p-3 text-xs shadow-md"
        style={{
          left: placeRight ? hover.xRel + 12 : hover.xRel - 12 - 224,
          top: Math.max(0, hover.yRel - 80),
        }}
      >
        <div className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
          {p.quarter}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: AI_COLOR }}
          />
          <span className="text-foreground">
            AI: {p.ai ? `${p.ai.rate.toFixed(1).replace(".", ",")} %` : "—"}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: NON_AI_COLOR }}
          />
          <span className="text-foreground">
            Ikke-AI: {p.nonAi ? `${p.nonAi.rate.toFixed(1).replace(".", ",")} %` : "—"}
          </span>
        </div>
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
        aria-label="Linjediagram for kohort-overlevelse, AI mot ikke-AI"
      >
        {/* Y gridlines at 25% intervals of the visible range */}
        {[0.25, 0.5, 0.75].map((frac) => {
          const y = VIEW_H * frac;
          return (
            <line
              key={frac}
              x1={0}
              y1={y}
              x2={VIEW_W}
              y2={y}
              stroke="currentColor"
              strokeOpacity={0.08}
              strokeWidth={1}
            />
          );
        })}
        <path d={nonAiPath} fill="none" stroke={NON_AI_COLOR} strokeWidth={2.5} />
        <path d={aiPath} fill="none" stroke={AI_COLOR} strokeWidth={2.5} />
        {hover ? (
          <>
            <line
              x1={xAt(hover.idx)}
              y1={0}
              x2={xAt(hover.idx)}
              y2={VIEW_H}
              stroke="currentColor"
              strokeOpacity={0.18}
              strokeWidth={1}
            />
            {points[hover.idx].ai ? (
              <circle
                cx={xAt(hover.idx)}
                cy={yAt(points[hover.idx].ai!.rate)}
                r={5}
                fill={AI_COLOR}
                stroke="white"
                strokeWidth={2}
              />
            ) : null}
            {points[hover.idx].nonAi ? (
              <circle
                cx={xAt(hover.idx)}
                cy={yAt(points[hover.idx].nonAi!.rate)}
                r={5}
                fill={NON_AI_COLOR}
                stroke="white"
                strokeWidth={2}
              />
            ) : null}
          </>
        ) : null}
      </svg>
      {tooltip}

      {/* Legend — inline at top-right of the svg viewport */}
      <div className="pointer-events-none absolute right-2 top-2 flex flex-col gap-1 rounded-md border bg-card/80 px-2 py-1 text-[0.7rem] backdrop-blur">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-1 w-3 rounded"
            style={{ background: AI_COLOR }}
          />
          <span>AI-relevante</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-1 w-3 rounded"
            style={{ background: NON_AI_COLOR }}
          />
          <span>Ikke-AI</span>
        </div>
      </div>
    </div>
  );
}
