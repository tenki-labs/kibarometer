import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/app/admin/_components/submit-button";
import { fmtDateTime } from "@/lib/admin/flash";

// Heartbeat + drain-progress banner shown while the NAV backfill drain
// is running. Lives in the admin component layer so the NAV hub
// (/admin/job-market) and any future operator views can render it
// without duplicating the markup. Stop button is wired by the caller —
// we don't import any actions module here so this stays domain-neutral
// (a future drain coordinator on a different pipeline could reuse it).

type DrainMeta = {
  phase?: string;
  drain_started_at?: string | null;
  batches_completed?: number;
  last_event_at?: string | null;
};

export type DrainCoordinatorRow = {
  id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  last_heartbeat: string | null;
  current_step: string | null;
  progress_pct: number | null;
  metadata: DrainMeta | null;
};

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 3_600_000)
    return `${Math.floor(ms / 60_000)} min ${Math.floor((ms % 60_000) / 1000)} s`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h} t ${m} min`;
}

function heartbeatFreshness(
  last: string | null,
): { label: string; tone: "green" | "yellow" | "red" | "muted" } {
  if (!last) return { label: "ingen", tone: "muted" };
  const ageMs = Date.now() - new Date(last).getTime();
  if (ageMs < 30_000)
    return { label: `${Math.round(ageMs / 1000)} s siden`, tone: "green" };
  if (ageMs < 120_000)
    return { label: `${Math.round(ageMs / 1000)} s siden`, tone: "yellow" };
  if (ageMs < 3_600_000)
    return { label: `${Math.round(ageMs / 60_000)} min siden`, tone: "red" };
  return { label: fmtDateTime(last), tone: "red" };
}

// Date.now() can't run inside a server component body without tripping
// react-hooks/purity, so the timing math lives in this helper (mirrors
// the existing pattern in admin pages).
function drainStats(row: DrainCoordinatorRow): {
  elapsedMs: number;
  pct: number | null;
  etaMs: number | null;
} {
  const startedAtMs = new Date(row.started_at).getTime();
  const elapsedMs = Date.now() - startedAtMs;
  const pct = row.progress_pct ?? null;
  const etaMs =
    pct != null && pct > 0 && pct < 100
      ? Math.round((elapsedMs * (100 - pct)) / pct)
      : null;
  return { elapsedMs, pct, etaMs };
}

const TONE_CLASS: Record<string, string> = {
  green:
    "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
  yellow:
    "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
  red:
    "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-100",
  muted: "",
};

type Props = {
  row: DrainCoordinatorRow;
  stopAction: () => Promise<void>;
};

export function DrainBanner({ row, stopAction }: Props) {
  const meta = row.metadata ?? {};
  const phase = meta.phase ?? "starting";
  const batches = meta.batches_completed ?? 0;
  const lastEvent = meta.last_event_at ?? null;
  const { elapsedMs, pct, etaMs } = drainStats(row);
  const fresh = heartbeatFreshness(row.last_heartbeat);

  return (
    <Card className="mb-6 border-emerald-200 dark:border-emerald-900">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="font-mono text-xs uppercase tracking-[0.18em]">
            Backfill pågår
          </CardTitle>
          <Badge variant="outline" className="font-mono text-[0.65rem] uppercase">
            {phase}
          </Badge>
          <Badge
            variant="outline"
            className={`font-mono text-[0.65rem] ${TONE_CLASS[fresh.tone]}`}
          >
            heartbeat: {fresh.label}
          </Badge>
        </div>
        <CardDescription>
          {row.current_step ?? "starter…"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div
            className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct ?? undefined}
          >
            <div
              className={
                pct == null
                  ? "absolute inset-y-0 left-0 w-full bg-[length:1rem_1rem] bg-[linear-gradient(45deg,rgba(0,0,0,0.08)_25%,transparent_25%,transparent_50%,rgba(0,0,0,0.08)_50%,rgba(0,0,0,0.08)_75%,transparent_75%,transparent)]"
                  : "absolute inset-y-0 left-0 bg-foreground transition-all"
              }
              style={
                pct != null
                  ? { width: `${Math.min(100, Math.max(0, pct))}%` }
                  : undefined
              }
            />
          </div>
          <div className="w-16 text-right font-mono text-sm tabular-nums">
            {pct != null ? `${pct.toFixed(1)}%` : "—"}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div>
            <div className="text-muted-foreground">Batcher</div>
            <div className="font-mono tabular-nums">{batches}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Siste hendelse</div>
            <div className="font-mono">
              {lastEvent ? fmtDateTime(lastEvent) : "—"}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Forløpt</div>
            <div className="font-mono">{formatElapsed(elapsedMs)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">ETA</div>
            <div className="font-mono">
              {etaMs != null ? formatElapsed(etaMs) : "—"}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            Auto-oppdaterer hvert 3. sekund. Pågående batch fullfører før loopen
            slutter ved stopp.
          </div>
          <form action={stopAction}>
            <SubmitButton
              variant="outline"
              size="sm"
              pendingLabel="Stopper…"
            >
              Stopp backfill
            </SubmitButton>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}
