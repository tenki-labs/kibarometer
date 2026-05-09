"use client";

import { useMemo, useState } from "react";

import { HBarList } from "@/app/_components/charts";
import { FYLKER, type Fylke, normalizeFylke } from "@/lib/fylke";
import type { NorwayFylkePath } from "@/lib/norway-paths";
import type { SnapshotGeography } from "@/lib/supabase";

function fillForShare(share: number): string {
  // share in [0,1]. Five-bin scale ramping from very light to saturated.
  if (share === 0) return "oklch(0.96 0 0)";
  if (share < 0.05) return "oklch(0.85 0.06 250)";
  if (share < 0.15) return "oklch(0.75 0.10 250)";
  if (share < 0.30) return "oklch(0.65 0.14 250)";
  if (share < 0.50) return "oklch(0.55 0.18 250)";
  return "oklch(0.45 0.22 250)";
}

type Props = {
  geography: SnapshotGeography[];
  paths: readonly NorwayFylkePath[];
  viewBox: string;
};

export function NorwayMap({ geography, paths, viewBox }: Props) {
  const aggregated = useMemo(() => {
    const m = new Map<Fylke, { ai: number; total: number }>();
    for (const f of FYLKER) m.set(f, { ai: 0, total: 0 });
    for (const row of geography) {
      const f = normalizeFylke(row.county);
      if (!f) continue;
      const cur = m.get(f)!;
      cur.ai += row.ai_count_30d;
      cur.total += row.total_count_30d;
    }
    return m;
  }, [geography]);

  const grandTotalAi = useMemo(
    () => [...aggregated.values()].reduce((a, v) => a + v.ai, 0),
    [aggregated],
  );

  const [hover, setHover] = useState<{
    fylke: Fylke;
    xRel: number;
    yRel: number;
    wrapperW: number;
  } | null>(null);

  function trackPointer(e: React.PointerEvent<SVGGElement>, fylke: Fylke) {
    const wrapper = (e.currentTarget.ownerSVGElement?.parentElement) as HTMLDivElement | null;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    setHover({
      fylke,
      xRel: e.clientX - rect.left,
      yRel: e.clientY - rect.top,
      wrapperW: rect.width,
    });
  }

  const hbarRows = [...FYLKER]
    .map((f) => ({
      label: f,
      value: aggregated.get(f)!.ai,
      total: aggregated.get(f)!.total || undefined,
    }))
    .sort((a, b) => b.value - a.value);

  return (
    <>
      {/* Desktop: real geographic choropleth */}
      <div className="relative hidden h-full w-full sm:block">
        <svg
          viewBox={viewBox}
          preserveAspectRatio="xMidYMid meet"
          className="h-full max-h-[60svh] w-full"
          role="img"
          aria-label="Kart over AI-stillinger per fylke"
        >
          {paths.map((p) => {
            const data = aggregated.get(p.fylke)!;
            const share = grandTotalAi > 0 ? data.ai / grandTotalAi : 0;
            return (
              <g
                key={p.fylke}
                onPointerEnter={(e) => trackPointer(e, p.fylke)}
                onPointerMove={(e) => trackPointer(e, p.fylke)}
                onPointerLeave={() => setHover(null)}
                style={{ cursor: "pointer" }}
              >
                <path
                  d={p.d}
                  fill={fillForShare(share)}
                  stroke="rgba(0,0,0,0.25)"
                  strokeWidth={0.5}
                  strokeLinejoin="round"
                />
              </g>
            );
          })}
        </svg>

        <p className="mt-2 text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
          Fylkesgrenser: © Kartverket (NLOD 2.0) via{" "}
          <a
            href="https://github.com/robhop/fylker-og-kommuner"
            target="_blank"
            rel="noreferrer"
            className="underline-offset-2 hover:underline"
          >
            robhop/fylker-og-kommuner
          </a>{" "}
          (CC BY 4.0)
        </p>

        {hover ? (() => {
          const data = aggregated.get(hover.fylke)!;
          const share = grandTotalAi > 0 ? data.ai / grandTotalAi : 0;
          const placeRight = hover.xRel < hover.wrapperW - 240;
          return (
            <div
              className="pointer-events-none absolute z-10 w-[14rem] rounded-md border bg-popover p-3 text-xs shadow-md"
              style={{
                left: placeRight ? hover.xRel + 12 : hover.xRel - 12 - 224,
                top: Math.max(0, hover.yRel - 50),
              }}
            >
              <div className="text-sm font-medium tracking-tight text-foreground">
                {hover.fylke}
              </div>
              <div className="mt-2 tabular-nums">
                {data.ai.toLocaleString("nb-NO")} AI-stillinger
                {data.total > 0 ? (
                  <>
                    {" "}
                    av {data.total.toLocaleString("nb-NO")} totalt
                  </>
                ) : null}
              </div>
              {grandTotalAi > 0 ? (
                <div className="mt-1 text-muted-foreground">
                  {(share * 100).toFixed(1).replace(".", ",")} % av AI-stillingene
                </div>
              ) : null}
            </div>
          );
        })() : null}
      </div>

      {/* Mobile: ranked bar list */}
      <div className="sm:hidden">
        <HBarList rows={hbarRows} lowSampleThreshold={null} />
      </div>
    </>
  );
}
