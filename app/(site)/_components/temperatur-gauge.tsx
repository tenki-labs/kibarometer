// app/(site)/_components/temperatur-gauge.tsx — landing-page gauge bar.
// Pure CSS gradient (cool → mid → warm) with a foreground marker at the
// current reading and a faint tick at the neutral center. Server component,
// no recharts, no client JS.
//
// This is a DIVERGING gauge: the center (50 %, grey) is neutral — 0 % change
// for the momentum cards, index 50 for media — and the marker diverges left
// (cold/negative) or right (warm/positive). The caller computes `markerPct`
// (0..100) via the diverging math in ../_lib/gauge.ts so the marker's
// direction agrees with the headline's sign.

type Props = {
  /** Marker position as a percent of the bar width (0 = left, 100 = right). */
  markerPct: number;
  ariaLabel?: string;
};

export function TemperaturGauge({ markerPct, ariaLabel }: Props) {
  const pct = Math.max(0, Math.min(100, markerPct));

  return (
    <div className="relative h-3.5 w-full" role="img" aria-label={ariaLabel}>
      <div
        className="absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 rounded-full"
        style={{
          background:
            "linear-gradient(to right, oklch(0.62 0.10 250), oklch(0.82 0.015 250), oklch(0.65 0.13 25))",
        }}
      />
      {/* Neutral center tick (0 % change / index 50). */}
      <span
        aria-hidden="true"
        className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-foreground/20"
        style={{ left: "50%" }}
      />
      <span
        aria-hidden="true"
        className="absolute top-1/2 h-3.5 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-[1px] bg-foreground ring-[1.5px] ring-background"
        style={{ left: `${pct}%` }}
      />
    </div>
  );
}
