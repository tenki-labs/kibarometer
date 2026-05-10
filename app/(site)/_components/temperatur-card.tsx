// app/(site)/_components/temperatur-card.tsx — landing-page pillar card.
// Black-white baseline; the gauge bar is the single colored element on the
// page. Hierarchy: pillar label → MoM momentum (the headline) → gauge →
// level caption. Server component.

import Link from "next/link";

import { TemperaturGauge } from "./temperatur-gauge";

type GaugeData = {
  value: number;
  min: number;
  max: number;
  p10: number;
  p50: number;
  p90: number;
};

type Props = {
  href: string;
  pillarLabel: string;
  /** Pre-formatted headline number, e.g. "↑ +11 %" / "↓ −4 %" / "55". */
  headlineValue: string;
  /** Small caption below the headline, e.g. "siste 30 dager vs. foregående 30" or "kibarometer-indeks · siste 30 dager". */
  headlineCaption: string;
  /** "høyt" / "over snitt" / "under snitt" / "lavt" / "ukjent posisjon". */
  levelLabel: string;
  /** Absolute level context, e.g. "6 800 ai-stillinger siste 30 dager". */
  levelCaption: string;
  gauge: GaugeData | null;
};

export function TemperaturCard({
  href,
  pillarLabel,
  headlineValue,
  headlineCaption,
  levelLabel,
  levelCaption,
  gauge,
}: Props) {
  const ariaLabel = `${pillarLabel}: ${headlineValue} ${headlineCaption}, nivå ${levelLabel} (${levelCaption})`;

  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className="group flex flex-col gap-6 rounded-lg border border-border bg-card p-6 transition-colors hover:border-foreground/40"
    >
      <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {pillarLabel}
      </span>

      <div className="flex flex-col gap-2">
        <div className="text-4xl font-medium leading-none tabular-nums tracking-tight sm:text-5xl">
          {headlineValue}
        </div>
        <span className="text-xs text-muted-foreground">{headlineCaption}</span>
      </div>

      {gauge ? (
        <div className="mt-auto flex flex-col gap-2.5">
          <TemperaturGauge
            value={gauge.value}
            min={gauge.min}
            max={gauge.max}
            p10={gauge.p10}
            p50={gauge.p50}
            p90={gauge.p90}
            ariaLabel={`${pillarLabel} nivå: ${levelLabel}`}
          />
          <p className="text-xs leading-snug text-muted-foreground">
            <span className="capitalize text-foreground">{levelLabel}</span>{" "}
            <span aria-hidden="true">·</span> {levelCaption}
          </p>
        </div>
      ) : (
        <p className="mt-auto text-xs text-muted-foreground">{levelCaption}</p>
      )}
    </Link>
  );
}

export function TemperaturCardEmpty({
  href,
  pillarLabel,
}: {
  href: string;
  pillarLabel: string;
}) {
  return (
    <Link
      href={href}
      className="group flex min-h-[14rem] flex-col gap-3 rounded-lg border border-dashed border-border bg-card p-6 transition-colors hover:border-foreground/40"
    >
      <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {pillarLabel}
      </span>
      <div className="my-auto text-sm text-muted-foreground">
        Data utilgjengelig
      </div>
    </Link>
  );
}
