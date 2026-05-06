"use client";

import type { BrregSnapshotHeadline } from "@/lib/supabase";

type Props = {
  headline: BrregSnapshotHeadline | null;
};

const NB = new Intl.NumberFormat("nb-NO");

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return NB.format(n);
}

function pct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined) return "—";
  return `${(n * 100).toFixed(digits).replace(".", ",")} %`;
}

function pp(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined) return "—";
  const sign = n > 0 ? "↑" : n < 0 ? "↓" : "—";
  return `${sign} ${(Math.abs(n) * 100).toFixed(digits).replace(".", ",")} %`;
}

export function Hero({ headline }: Props) {
  return (
    <div className="flex h-full w-full flex-col justify-center gap-8 px-4 py-10 sm:px-8">
      <div>
        <p className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Oppstartsbarometeret
        </p>
        <h1 className="mt-3 text-3xl font-medium leading-[1.05] tracking-tight sm:text-5xl">
          Norske oppstartsbedrifter
        </h1>
        <p className="mt-4 max-w-2xl text-sm text-muted-foreground sm:text-base">
          Daglig oppdatert oversikt over nyregistrerte foretak fra
          Brønnøysundregistrene. AI-andel, selskapsformer, vekst og overlevelse
          per kvartal.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3">
        <Stat
          label="Nye foretak siste 30 dager"
          value={fmt(headline?.total_30d)}
          hint={`${fmt(headline?.total_7d)} siste 7 dager`}
          big
        />
        <Stat
          label="AI-relevante 30 dager"
          value={fmt(headline?.ai_relevant_count_30d)}
          hint={`${pct(headline?.ai_relevant_share_30d)} av totalen`}
        />
        <Stat
          label="Veksttakt AI-relevante"
          value={pp(headline?.ai_relevant_mom_growth)}
          hint={`Måned-over-måned (Q-o-Q ${pp(headline?.ai_relevant_qoq_growth)})`}
        />
        <Stat
          label="Median aksjekapital, AI-AS"
          value={
            headline?.aksjekapital_median_ai_relevant_as_30d != null
              ? `${fmt(headline.aksjekapital_median_ai_relevant_as_30d)} kr`
              : "—"
          }
          hint={
            headline?.aksjekapital_median_non_ai_as_30d != null
              ? `vs. ${fmt(headline.aksjekapital_median_non_ai_as_30d)} kr (ikke-AI)`
              : "Sammenligning mangler"
          }
        />
        <Stat
          label="Andel i IT/kreativ/tjenester"
          value={pct(headline?.enriched_combined_share_30d)}
          hint={`IT ${pct(headline?.it_share_30d)} · kreativ ${pct(
            headline?.kreativ_media_share_30d,
          )} · tjenester ${pct(headline?.tjenester_share_30d)}`}
        />
        <Stat
          label="AS-andel av AI-relevante"
          value={pct(headline?.as_share_of_ai_relevant_30d)}
          hint={`ENK ${pct(headline?.enk_share_of_ai_relevant_30d)} · annet ${pct(
            headline
              ? 1 -
                  headline.as_share_of_ai_relevant_30d -
                  headline.enk_share_of_ai_relevant_30d
              : null,
          )}`}
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
            ? "text-4xl font-medium leading-none tabular-nums sm:text-5xl"
            : "text-2xl font-medium leading-none tabular-nums sm:text-3xl"
        }
      >
        {value}
      </p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
