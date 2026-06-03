// app/(site)/_components/temperatur-gauge.tsx — landing-page gauge bar.
// Pure CSS gradient (cool → mid → warm) with a foreground marker at the
// current value and tiny ticks at p10/p50/p90 of the trailing-90d
// distribution. Server component, no recharts, no client JS.
//
// The bar's gradient is the only color on the landing page — the marker
// uses the foreground color so it stays high-contrast against the gradient
// in both light and dark mode.
//
// Marker + tick positions come from gaugePositionPct (percentile rank, not a
// linear min→max sweep) so the median sits dead-center and the marker agrees
// with the level label. See app/(site)/_lib/gauge.ts.

import { gaugePositionPct } from "../_lib/gauge";

type Props = {
  value: number;
  min: number;
  max: number;
  p10: number;
  p50: number;
  p90: number;
  ariaLabel?: string;
};

export function TemperaturGauge({
  value,
  min,
  max,
  p10,
  p50,
  p90,
  ariaLabel,
}: Props) {
  const bounds = { min, max, p10, p50, p90 };
  const markerPct = gaugePositionPct(value, bounds);
  const p10Pct = gaugePositionPct(p10, bounds);
  const p50Pct = gaugePositionPct(p50, bounds);
  const p90Pct = gaugePositionPct(p90, bounds);

  return (
    <div className="relative h-3.5 w-full" role="img" aria-label={ariaLabel}>
      <div
        className="absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 rounded-full"
        style={{
          background:
            "linear-gradient(to right, oklch(0.62 0.10 250), oklch(0.82 0.015 250), oklch(0.65 0.13 25))",
        }}
      />
      {[p10Pct, p50Pct, p90Pct].map((p, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-foreground/20"
          style={{ left: `${p}%` }}
        />
      ))}
      <span
        aria-hidden="true"
        className="absolute top-1/2 h-3.5 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-[1px] bg-foreground ring-[1.5px] ring-background"
        style={{ left: `${markerPct}%` }}
      />
    </div>
  );
}
