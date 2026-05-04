import type { SnapshotHeadline } from "@/lib/supabase";

const NO_DATETIME = new Intl.DateTimeFormat("nb-NO", {
  day: "2-digit",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function fmtNumber(n: number): string {
  return n.toLocaleString("nb-NO");
}

function fmtDelta(current: number, prior: number): string | null {
  if (prior === 0) return null;
  const pct = ((current - prior) / prior) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1).replace(".", ",")} %`;
}

export function Hero({ headline }: { headline: SnapshotHeadline | null }) {
  if (!headline) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-muted-foreground">
        Snapshots ikke regnet ennå.
      </div>
    );
  }
  const delta = fmtDelta(headline.ai_count_30d, headline.ai_count_prev_30d);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground">
        AI-stillinger siste 30 dager
      </div>
      <div className="text-7xl font-medium tabular-nums tracking-tight sm:text-[10rem]">
        {fmtNumber(headline.ai_count_30d)}
      </div>
      <div className="max-w-[60ch] text-sm text-muted-foreground">
        Siste 30 dager · oppdatert {NO_DATETIME.format(new Date(headline.computed_at))}
        {delta ? <> · {delta} siden forrige måned</> : null}
      </div>
    </div>
  );
}
