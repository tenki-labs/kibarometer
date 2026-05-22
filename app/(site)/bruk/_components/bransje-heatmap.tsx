"use client";

// Bransje × frequency heatmap. Cells colored by share within the bransje
// (intra-sector AI adoption intensity). Powered by the 'by_q1_q2_heatmap'
// cut in bruk_aggregate_snapshot (bucket = '<slug>:<frequency>').
//
// Pure CSS grid — no recharts needed. Cell color = HSL where lightness
// inversely tracks share, capped at the brand foreground.

import * as React from "react";

type Row = {
  bucket: string; // "<bransje-slug>:<frequency>"
  confirmed_count: number;
  share_pct: number | null;
};

type Props = {
  rows: Row[];
  taxonomyLabel: (slug: string) => string;
};

const FREQUENCY_ORDER = [
  "daglig",
  "ukentlig",
  "av-og-til",
  "proevd-ikke-regelmessig",
  "aldri",
];

const FREQUENCY_LABELS: Record<string, string> = {
  daglig: "Hver dag",
  ukentlig: "Ukentlig",
  "av-og-til": "Av og til",
  "proevd-ikke-regelmessig": "Prøvd",
  aldri: "Aldri",
};

type Cell = {
  bransje: string;
  frequency: string;
  count: number;
  share: number;
};

function parseRows(rows: Row[]): {
  bransjer: string[];
  cells: Map<string, Cell>;
} {
  const cells = new Map<string, Cell>();
  const bransjeSet = new Set<string>();
  for (const r of rows) {
    const [bransje, frequency] = r.bucket.split(":");
    if (!bransje || !frequency) continue;
    bransjeSet.add(bransje);
    cells.set(`${bransje}:${frequency}`, {
      bransje,
      frequency,
      count: r.confirmed_count,
      share: r.share_pct ?? 0,
    });
  }
  // Sort bransjer by total respondents desc.
  const totals = new Map<string, number>();
  for (const cell of cells.values()) {
    totals.set(cell.bransje, (totals.get(cell.bransje) ?? 0) + cell.count);
  }
  const bransjer = Array.from(bransjeSet).sort(
    (a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0),
  );
  return { bransjer, cells };
}

function intensityColor(share: number, maxShare: number): string {
  if (share <= 0 || maxShare <= 0) return "var(--muted)";
  const t = Math.min(1, share / maxShare);
  // Lightness: 95% at 0, 25% at max. Inverted so high share = dark cell.
  const lightness = 95 - t * 70;
  return `hsl(220 30% ${lightness}%)`;
}

export function BransjeHeatmap({ rows, taxonomyLabel }: Props) {
  const { bransjer, cells } = React.useMemo(() => parseRows(rows), [rows]);
  const maxShare = React.useMemo(
    () => Math.max(...Array.from(cells.values()).map((c) => c.share), 1),
    [cells],
  );

  if (bransjer.length === 0) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        Ingen bransje-respondenter ennå.
      </div>
    );
  }

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th className="text-left font-normal text-muted-foreground" />
            {FREQUENCY_ORDER.map((freq) => (
              <th
                key={freq}
                className="px-2 py-1 text-left font-normal text-muted-foreground"
              >
                {FREQUENCY_LABELS[freq]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bransjer.map((bransje) => (
            <tr key={bransje}>
              <td className="pr-3 py-1 text-left font-medium">
                {taxonomyLabel(bransje)}
              </td>
              {FREQUENCY_ORDER.map((freq) => {
                const cell = cells.get(`${bransje}:${freq}`);
                const share = cell?.share ?? 0;
                const count = cell?.count ?? 0;
                return (
                  <td
                    key={freq}
                    className="px-2 py-1 tabular-nums"
                    style={{
                      background: intensityColor(share, maxShare),
                      color: share / maxShare > 0.6 ? "white" : "inherit",
                    }}
                    title={`${taxonomyLabel(bransje)} · ${FREQUENCY_LABELS[freq]}: ${count} svar (${share.toFixed(1)}%)`}
                  >
                    {count > 0 ? `${share.toFixed(0)}%` : "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
