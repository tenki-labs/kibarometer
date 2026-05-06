import Link from "next/link";
import { Hammer } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/app/admin/_components/submit-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Flash } from "@/app/admin/_components/flash";
import { PageHeader } from "@/app/admin/_components/page-header";
import { StatCard } from "@/app/admin/_components/stat-card";
import { StatusBadge } from "@/app/admin/_components/status-badge";
import { sbFetch } from "@/lib/admin/sb";
import { fmtDateTime } from "@/lib/admin/flash";
import {
  enrichAction,
  fastForwardAction,
  fetchAction,
  refreshSnapshotsAction,
  stopDrainAction,
  toggleCronPausedAction,
} from "./actions";
import { pastFFThreshold } from "@/lib/admin/legacy/fast-forward.js";
import { AutoRefresh } from "@/app/admin/_components/auto-refresh";

const BACKFILL_JOB = "backfill_nav_stillingsfeed";
const TRIGGER_LABEL: Record<string, string> = {
  manual: "manuell",
  cron: "cron",
  "fast-forward": "drain",
};

type JobRow = {
  id: string;
  name: string;
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  rows_processed: number | null;
  error: string | null;
  progress_pct: number | null;
  current_step: string | null;
};

type BackfillMeta = {
  next_cursor?: string | null;
  tail_cursor?: string | null;
  completed?: boolean;
  last_event_at?: string | null;
};

type LatestBackfill = {
  metadata: BackfillMeta | null;
  status: string;
  started_at: string;
};

type DrainMeta = {
  phase?: string;
  drain_started_at?: string | null;
  batches_completed?: number;
  last_event_at?: string | null;
};

type DrainCoordinatorRow = {
  id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  last_heartbeat: string | null;
  current_step: string | null;
  progress_pct: number | null;
  metadata: DrainMeta | null;
};

type AppSettings = { cron_paused: boolean; updated_at: string };

type SnapshotHeadline = {
  computed_for: string;
  computed_at: string;
  ai_count_7d: number;
  ai_count_30d: number;
  ai_share_30d: number;
};

type EnrichQueueRow = { id: string };

function durationLabel(started: string, finished: string | null): string {
  if (!finished) return "—";
  const ms = new Date(finished).getTime() - new Date(started).getTime();
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 1000)} s`;
}

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

// Compute drain banner stats outside the component body so the
// `react-hooks/purity` rule doesn't flag the Date.now() call
// (mirrors the helper-extraction pattern used elsewhere in admin).
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

function DrainBanner({ row }: { row: DrainCoordinatorRow }) {
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
          <form action={stopDrainAction}>
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

function backfillStateLine(meta: BackfillMeta | null): string {
  if (!meta) return "Ikke startet ennå.";
  const last = meta.last_event_at
    ? ` Siste hendelse: ${fmtDateTime(meta.last_event_at)}.`
    : "";
  if (meta.completed) {
    const head = meta.tail_cursor
      ? `${String(meta.tail_cursor).slice(0, 8)}…`
      : "?";
    return `Innhentet til live head — daglig polling kl. 06:00 UTC. Head: ${head}.${last}`;
  }
  const cursor = meta.next_cursor
    ? `${String(meta.next_cursor).slice(0, 8)}…`
    : "start";
  if (!pastFFThreshold(meta.last_event_at)) {
    return `Hopper over pre-2024 (markør: ${cursor}).${last}`;
  }
  return `Innhenter (markør: ${cursor}).${last}`;
}

type TriggerCardProps = {
  title: string;
  description: React.ReactNode;
  status?: React.ReactNode;
  buttonLabel: string;
  action: () => Promise<void>;
  disabled?: boolean;
};

function TriggerCard({
  title,
  description,
  status,
  buttonLabel,
  action,
  disabled,
}: TriggerCardProps) {
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="font-mono text-xs uppercase tracking-[0.18em]">
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1 text-sm text-muted-foreground">{status}</div>
        <form action={action}>
          <SubmitButton
            variant="outline"
            size="sm"
            pendingLabel="Kjører…"
            disabled={disabled}
          >
            {buttonLabel}
          </SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function JobsPage({ searchParams }: Props) {
  const params = await searchParams;

  const [
    rows,
    latestBackfill,
    drainCoord,
    enrichQueue,
    latestHeadline,
    appSettings,
  ] = await Promise.all([
    sbFetch<JobRow[]>(
      `/jobs?select=id,name,trigger,status,started_at,finished_at,rows_processed,error,progress_pct,current_step&order=started_at.desc&limit=50`,
      { service: true },
    ),
    sbFetch<LatestBackfill[]>(
      `/jobs?name=eq.${BACKFILL_JOB}&order=started_at.desc&limit=1&select=metadata,status,started_at`,
      { service: true },
    ),
    sbFetch<DrainCoordinatorRow[]>(
      `/jobs?name=eq.backfill_drain&order=started_at.desc&limit=1` +
        `&select=id,status,started_at,finished_at,last_heartbeat,current_step,progress_pct,metadata`,
      { service: true },
    ).catch(() => [] as DrainCoordinatorRow[]),
    sbFetch<EnrichQueueRow[]>(
      `/nav_postings?status=eq.ACTIVE&detail_fetched_at=is.null&select=id&limit=1`,
      { service: true },
    ).catch(() => [] as EnrichQueueRow[]),
    sbFetch<SnapshotHeadline[]>(
      `/snapshot_headline?order=computed_for.desc&limit=1&select=computed_for,computed_at,ai_count_7d,ai_count_30d,ai_share_30d`,
      { service: true },
    ).catch(() => [] as SnapshotHeadline[]),
    sbFetch<AppSettings[]>(
      `/app_settings?id=eq.1&select=cron_paused,updated_at`,
      { service: true },
    ).catch(() => [] as AppSettings[]),
  ]);

  const backfillMeta = latestBackfill[0]?.metadata ?? null;
  const drain = drainCoord[0] ?? null;
  const drainRunning = drain?.status === "running";
  const enrichQueueHas = enrichQueue.length > 0;
  const headline = latestHeadline[0] ?? null;
  const cronPaused = appSettings[0]?.cron_paused ?? false;
  const cronUpdatedAt = appSettings[0]?.updated_at ?? null;

  // Aggregate stats for the top row.
  const successCount = rows.filter((r) => r.status === "success").length;
  const failedCount = rows.filter((r) => r.status === "failed").length;
  const runningCount = rows.filter((r) => r.status === "running").length;
  const lastSuccess = rows.find((r) => r.status === "success");

  return (
    <>
      <AutoRefresh
        enabled={drainRunning || runningCount > 0}
        intervalMs={3000}
      />
      <Flash searchParams={params} />
      <PageHeader
        eyebrow="Drift"
        title="Jobber"
        description="Manuelle triggere for NAV-fetch, backfill, berikelse og snapshot-refresh — og loggen for de siste 50 kjøringene."
      />

      {drainRunning && drain ? <DrainBanner row={drain} /> : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Vellykkede"
          value={successCount}
          hint={
            lastSuccess
              ? `Sist: ${fmtDateTime(lastSuccess.started_at)}`
              : "Ingen kjøringer ennå"
          }
        />
        <StatCard
          label="Feilet"
          value={failedCount}
          hint={
            failedCount > 0
              ? "Sjekk feilmeldinger i tabellen"
              : "Ingen feil i siste 50"
          }
        />
        <StatCard
          label="Kjører nå"
          value={runningCount}
          hint={runningCount > 0 ? "Pågår" : "Klar"}
        />
        <StatCard
          label="AI-stillinger 7d"
          value={headline?.ai_count_7d ?? "—"}
          hint={
            headline
              ? `Andel 30d: ${headline.ai_share_30d != null ? (headline.ai_share_30d * 100).toFixed(2) + "%" : "—"}`
              : "Aldri kjørt"
          }
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2 lg:auto-rows-fr">
        <TriggerCard
          title="NAV Stillingsfeed"
          description={
            <>
              Henter siste side fra{" "}
              <code className="font-mono text-xs">
                pam-stilling-feed.nav.no/api/v1/feed
              </code>{" "}
              og lagrer rå-payload i{" "}
              <code className="font-mono text-xs">nav_raw</code>.
            </>
          }
          buttonLabel="Hent NAV nå"
          action={fetchAction}
        />
        <TriggerCard
          title="NAV backfill"
          description="Drainer hele feeden i én kjøring: hopper over alt før 2024-01-01 (NAV migrasjons-burst, ingen ingest), så full innhenting fra 2024-01-01 til live head. Tar ~3 timer."
          status={backfillStateLine(backfillMeta)}
          buttonLabel={drainRunning ? "Kjører…" : "BACKFILL"}
          action={fastForwardAction}
          disabled={drainRunning}
        />
        <TriggerCard
          title="Periodisk henting"
          description="Daglig poll av live head kl. 06:00 UTC for å fange nye stillinger NAV publiserer. Pause hvis du trenger å fryse ingestion (f.eks. NAV-utfall, debugging) — soft pause via app_settings.cron_paused."
          status={
            cronPaused
              ? `Pauset${cronUpdatedAt ? ` siden ${fmtDateTime(cronUpdatedAt)}` : ""}.`
              : `Aktiv${cronUpdatedAt ? `. Sist endret: ${fmtDateTime(cronUpdatedAt)}` : "."}`
          }
          buttonLabel={cronPaused ? "Aktiver daglig henting" : "Pause daglig henting"}
          action={toggleCronPausedAction}
        />
        <TriggerCard
          title="Berikelse av aktive stillinger"
          description={
            <>
              Henter{" "}
              <code className="font-mono text-xs">
                /api/v1/feedentry/{`{uuid}`}
              </code>{" "}
              for ACTIVE stillinger uten beskrivelse, slik at tagging treffer på beskrivelse + yrke (ikke bare tittel). Cron hvert 15. min, maks 200 stillinger / 60 s per batch.
            </>
          }
          status={
            enrichQueueHas ? "Stillinger venter på berikelse." : "Køen er tom."
          }
          buttonLabel="Beriker batch nå"
          action={enrichAction}
        />
        <TriggerCard
          title="Snapshot-refresh"
          description={
            <>
              Regner ut <code className="font-mono text-xs">snapshot_*</code>-tabellene som dashbordet leser. Kjører kl. 04:00 (etter backup). Trigg manuelt etter en re-tag eller stor backfill-burst.
            </>
          }
          status={
            headline
              ? `Sist regnet: ${fmtDateTime(headline.computed_at)}. AI-stillinger 7d: ${headline.ai_count_7d}, 30d: ${headline.ai_count_30d}.`
              : "Aldri kjørt — kjør én gang for å fylle dashbord-tabellene."
          }
          buttonLabel="Regn snapshots nå"
          action={refreshSnapshotsAction}
        />
      </div>

      <Card className="mt-6 gap-0 p-0">
        <CardHeader className="px-6 py-4">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.14em]">
              <Hammer className="size-4" />
              Siste 50 jobber
            </CardTitle>
            <span className="text-xs text-muted-foreground">
              {rows.length} {rows.length === 1 ? "rad" : "rader"}
            </span>
          </div>
        </CardHeader>
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Jobb</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Startet</TableHead>
              <TableHead>Varighet</TableHead>
              <TableHead className="text-right">Rader</TableHead>
              <TableHead>Trigger</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-12 text-center text-muted-foreground"
                >
                  Ingen jobber ennå.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => {
                const isRunning = r.status === "running";
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/admin/processes/${r.id}`}
                        className="underline decoration-dotted underline-offset-4 hover:opacity-80"
                      >
                        {r.name}
                      </Link>
                      {isRunning && r.current_step ? (
                        <div className="mt-1 max-w-md truncate text-[0.7rem] text-muted-foreground">
                          {r.current_step}
                        </div>
                      ) : null}
                      {isRunning ? (
                        <div
                          className="mt-1 h-1 w-32 overflow-hidden rounded-full bg-muted"
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={r.progress_pct ?? undefined}
                        >
                          <div
                            className={
                              r.progress_pct == null
                                ? "h-full w-full bg-foreground/30"
                                : "h-full bg-foreground transition-all"
                            }
                            style={
                              r.progress_pct != null
                                ? { width: `${Math.min(100, Math.max(0, r.progress_pct))}%` }
                                : undefined
                            }
                          />
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {fmtDateTime(r.started_at)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {durationLabel(r.started_at, r.finished_at)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.rows_processed ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <span className="font-mono uppercase tracking-wider">
                        {TRIGGER_LABEL[r.trigger] ?? r.trigger}
                      </span>
                      {r.error ? (
                        <div className="mt-1 max-w-md truncate text-destructive">
                          {r.error.slice(0, 200)}
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        </div>
      </Card>
    </>
  );
}
