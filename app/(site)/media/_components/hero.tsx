"use client";

import type { MediaSnapshotIndex } from "@/lib/supabase";

type Props = {
  latest: MediaSnapshotIndex | null;
  /** Index value 7 rows back, used to render the +/- delta vs last week. */
  prior: MediaSnapshotIndex | null;
};

const NB = new Intl.NumberFormat("nb-NO");

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return NB.format(n);
}

function indexLabel(value: number): string {
  if (value >= 65) return "Begeistret tilt";
  if (value >= 55) return "Lett positiv";
  if (value >= 45) return "Balansert";
  if (value >= 35) return "Lett negativ";
  return "Bekymret tilt";
}

export function Hero({ latest, prior }: Props) {
  const indexValue = latest?.index_value ?? null;
  const priorIndex = prior?.index_value ?? null;
  const indexDelta =
    indexValue !== null && priorIndex !== null
      ? indexValue - priorIndex
      : null;
  const aiArticles7d = latest?.ai_article_count_7d ?? 0;
  const aboveWater = latest?.categories_above_water ?? 0;
  const belowWater = latest?.categories_below_water ?? 0;

  return (
    <div className="flex h-full w-full flex-col justify-center gap-8 px-4 py-10 sm:px-8">
      <div>
        <p className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Mediedekning
        </p>
        <h1 className="mt-3 text-3xl font-medium leading-[1.05] tracking-tight sm:text-5xl">
          Norsk medieklima for kunstig intelligens
        </h1>
        <p className="mt-4 max-w-2xl text-sm text-muted-foreground sm:text-base">
          Daglig oppdatert kibarometer-indeks (0–100) over hvor positivt eller
          bekymret norske medier omtaler AI. Avledet av holdning og intensitet
          per artikkel, glattet over en 7-dagers rullerende periode.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3">
        <Stat
          label="Kibarometer-indeks"
          value={indexValue !== null ? String(indexValue) : "—"}
          hint={
            indexValue !== null
              ? `${indexLabel(indexValue)}${
                  indexDelta !== null
                    ? ` · ${indexDelta >= 0 ? "+" : ""}${indexDelta} vs forrige uke`
                    : " (50 = balansert)"
                }`
              : "Ingen data ennå"
          }
          big
        />
        <Stat
          label="AI-artikler siste 7 dager"
          value={fmt(aiArticles7d)}
        />
        <Stat
          label="Kategorier over null"
          value={`${aboveWater} / ${aboveWater + belowWater}`}
          hint={`${belowWater} under null`}
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  big = false,
}: {
  label: string;
  value: string;
  hint?: string;
  big?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p
        className={
          big
            ? "text-5xl font-medium leading-none tabular-nums sm:text-6xl"
            : "text-2xl font-medium leading-none tabular-nums sm:text-3xl"
        }
      >
        {value}
      </p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
