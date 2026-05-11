// Shared headline formatters. The pillar pages call these so their hero
// "big number" renders identical to the matching TemperaturCard on /.

const NB = new Intl.NumberFormat("nb-NO");

export function fmtNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return NB.format(n);
}

export type Momentum = { display: string; pct: number | null };

export function fmtMomentumPct(pct: number | null): Momentum {
  if (pct === null || !Number.isFinite(pct)) return { display: "—", pct: null };
  if (Math.abs(pct) < 1) return { display: "≈ 0 %", pct };
  const arrow = pct > 0 ? "↑" : "↓";
  const sign = pct > 0 ? "+" : "−";
  const abs = Math.abs(pct);
  const formatted =
    abs >= 10 ? abs.toFixed(0) : abs.toFixed(1).replace(".", ",");
  return { display: `${arrow} ${sign}${formatted} %`, pct };
}
