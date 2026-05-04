"use client";

import { useMemo, useState } from "react";

import { HBarList } from "@/app/_components/charts";
import { FYLKER, type Fylke, normalizeFylke } from "@/lib/fylke";
import type { SnapshotGeography } from "@/lib/supabase";

// Cartogram positions for the 15 fylker — each cell is one rect on a 5-col x
// 7-row grid that very roughly mirrors Norway's shape (Finnmark top-right,
// Agder bottom-left, etc.). NOT a geographically accurate map; the goal is
// to give viewers a spatial frame for the choropleth ranking. Swap to a real
// SVG when we ship one.
const CELLS: Record<Fylke, { row: number; col: number }> = {
  Finnmark: { row: 0, col: 4 },
  Troms: { row: 1, col: 3 },
  Nordland: { row: 2, col: 3 },
  Trøndelag: { row: 3, col: 2 },
  "Møre og Romsdal": { row: 3, col: 1 },
  Innlandet: { row: 4, col: 3 },
  Vestland: { row: 4, col: 1 },
  Akershus: { row: 5, col: 3 },
  Oslo: { row: 5, col: 4 },
  Buskerud: { row: 5, col: 2 },
  Rogaland: { row: 6, col: 0 },
  Agder: { row: 6, col: 1 },
  Telemark: { row: 6, col: 2 },
  Vestfold: { row: 6, col: 3 },
  Østfold: { row: 6, col: 4 },
};

const COLS = 5;
const ROWS = 7;

function fillForShare(share: number): string {
  // share in [0,1]. Five-bin scale ramping from very light to saturated.
  if (share === 0) return "oklch(0.96 0 0)";
  if (share < 0.05) return "oklch(0.85 0.06 250)";
  if (share < 0.15) return "oklch(0.75 0.10 250)";
  if (share < 0.30) return "oklch(0.65 0.14 250)";
  if (share < 0.50) return "oklch(0.55 0.18 250)";
  return "oklch(0.45 0.22 250)";
}

export function NorwayMap({ geography }: { geography: SnapshotGeography[] }) {
  // Aggregate raw NAV `county` strings to today's fylker.
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
      {/* Desktop: cartogram grid */}
      <div className="relative hidden h-full w-full sm:block">
        <svg
          viewBox={`0 0 ${COLS * 100} ${ROWS * 100}`}
          preserveAspectRatio="xMidYMid meet"
          className="h-full max-h-[60svh] w-full"
          role="img"
          aria-label="Kartogram over AI-stillinger per fylke"
        >
          {FYLKER.map((f) => {
            const { row, col } = CELLS[f];
            const data = aggregated.get(f)!;
            const share = grandTotalAi > 0 ? data.ai / grandTotalAi : 0;
            const x = col * 100 + 4;
            const y = row * 100 + 4;
            return (
              <g
                key={f}
                onPointerEnter={(e) => trackPointer(e, f)}
                onPointerMove={(e) => trackPointer(e, f)}
                onPointerLeave={() => setHover(null)}
                style={{ cursor: "pointer" }}
              >
                <rect
                  x={x}
                  y={y}
                  width={92}
                  height={92}
                  rx={6}
                  fill={fillForShare(share)}
                  stroke="rgba(0,0,0,0.15)"
                  strokeWidth={0.8}
                />
                <text
                  x={x + 46}
                  y={y + 42}
                  textAnchor="middle"
                  className="fill-foreground"
                  style={{ fontSize: "11px", fontWeight: 500 }}
                >
                  {f}
                </text>
                <text
                  x={x + 46}
                  y={y + 60}
                  textAnchor="middle"
                  className="fill-foreground"
                  style={{ fontSize: "13px", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}
                >
                  {data.ai.toLocaleString("nb-NO")}
                </text>
              </g>
            );
          })}
        </svg>

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
