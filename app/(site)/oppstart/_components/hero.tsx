import type { BrregSnapshotHeadline } from "@/lib/supabase";

const NB = new Intl.NumberFormat("nb-NO");

const NO_DATETIME = new Intl.DateTimeFormat("nb-NO", {
  day: "2-digit",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function fmtNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return NB.format(n);
}

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined) return "—";
  return `${(n * 100).toFixed(digits).replace(".", ",")} %`;
}

function fmtDelta(n: number | null | undefined): string | null {
  if (n === null || n === undefined) return null;
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${(Math.abs(n) * 100).toFixed(1).replace(".", ",")} %`;
}

export function Hero({ headline }: { headline: BrregSnapshotHeadline | null }) {
  if (!headline) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-muted-foreground">
        Snapshots ikke regnet ennå.
      </div>
    );
  }

  const delta = fmtDelta(headline.ai_relevant_mom_growth);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 px-6 text-center">
      <div className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground">
        AI-relevante foretak siste 30 dager
      </div>

      <div className="text-7xl font-medium tabular-nums tracking-tight sm:text-[10rem]">
        {fmtNumber(headline.ai_relevant_count_30d)}
      </div>

      <div className="max-w-[60ch] text-sm text-muted-foreground">
        Siste 30 dager · oppdatert {NO_DATETIME.format(new Date(headline.computed_at))}
        {delta ? <> · {delta} siden forrige måned</> : null}
      </div>

      <div className="mt-4 grid w-full max-w-2xl grid-cols-3 gap-x-6 text-left">
        <Stat
          label="Nye foretak 30d"
          value={fmtNumber(headline.total_30d)}
        />
        <Stat
          label="Median aksjekap. AI-AS"
          value={
            headline.aksjekapital_median_ai_relevant_as_30d != null
              ? `${fmtNumber(headline.aksjekapital_median_ai_relevant_as_30d)} kr`
              : "—"
          }
        />
        <Stat
          label="AS-andel av AI-rel."
          value={fmtPct(headline.as_share_of_ai_relevant_30d)}
        />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="font-mono text-[0.6rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <p className="text-xl font-medium leading-none tabular-nums sm:text-2xl">
        {value}
      </p>
    </div>
  );
}
