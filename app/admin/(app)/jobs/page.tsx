import Link from "next/link";
import { Hammer } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  backfillAction,
  enrichAction,
  fetchAction,
  refreshSnapshotsAction,
} from "./actions";
import { AutoRefresh } from "@/app/admin/_components/auto-refresh";

const BACKFILL_JOB = "backfill_nav_stillingsfeed";
const TRIGGER_LABEL: Record<string, string> = {
  manual: "manuell",
  cron: "cron",
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

type LatestBackfill = { metadata: BackfillMeta | null };

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

function backfillStateLine(meta: BackfillMeta | null): string {
  if (!meta) return "Ikke startet ennå.";
  const last = meta.last_event_at
    ? ` Siste hendelse: ${fmtDateTime(meta.last_event_at)}.`
    : "";
  if (meta.completed) {
    const head = meta.tail_cursor
      ? `${String(meta.tail_cursor).slice(0, 8)}…`
      : "?";
    return `Innhentet til live head — overvåker for nye hendelser. Head: ${head}.${last}`;
  }
  const cursor = meta.next_cursor
    ? `${String(meta.next_cursor).slice(0, 8)}…`
    : "start";
  return `Pågår. Neste markør: ${cursor}.${last}`;
}

type TriggerCardProps = {
  title: string;
  description: React.ReactNode;
  status?: React.ReactNode;
  buttonLabel: string;
  action: () => Promise<void>;
};

function TriggerCard({
  title,
  description,
  status,
  buttonLabel,
  action,
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
          <SubmitButton variant="outline" size="sm" pendingLabel="Kjører…">
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

  const [rows, latestBackfill, enrichQueue, latestHeadline] = await Promise.all(
    [
      sbFetch<JobRow[]>(
        `/jobs?select=id,name,trigger,status,started_at,finished_at,rows_processed,error,progress_pct,current_step&order=started_at.desc&limit=50`,
        { service: true },
      ),
      sbFetch<LatestBackfill[]>(
        `/jobs?name=eq.${BACKFILL_JOB}&order=started_at.desc&limit=1&select=metadata,status,started_at`,
        { service: true },
      ),
      sbFetch<EnrichQueueRow[]>(
        `/nav_postings?status=eq.ACTIVE&detail_fetched_at=is.null&select=id&limit=1`,
        { service: true },
      ).catch(() => [] as EnrichQueueRow[]),
      sbFetch<SnapshotHeadline[]>(
        `/snapshot_headline?order=computed_for.desc&limit=1&select=computed_for,computed_at,ai_count_7d,ai_count_30d,ai_share_30d`,
        { service: true },
      ).catch(() => [] as SnapshotHeadline[]),
    ],
  );

  const backfillMeta = latestBackfill[0]?.metadata ?? null;
  const enrichQueueHas = enrichQueue.length > 0;
  const headline = latestHeadline[0] ?? null;

  // Aggregate stats for the top row.
  const successCount = rows.filter((r) => r.status === "success").length;
  const failedCount = rows.filter((r) => r.status === "failed").length;
  const runningCount = rows.filter((r) => r.status === "running").length;
  const lastSuccess = rows.find((r) => r.status === "success");

  return (
    <>
      <AutoRefresh enabled={runningCount > 0} />
      <Flash searchParams={params} />
      <PageHeader
        eyebrow="Drift"
        title="Jobber"
        description="Manuelle triggere for NAV-fetch, backfill, berikelse og snapshot-refresh — og loggen for de siste 50 kjøringene."
      />

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
          title="NAV historisk backfill"
          description="Går gjennom hele feeden fra start (≈ 2023-06) framover, én batch per kjøring (maks 50 sider eller 60 s). Cron hvert 15. min — no-op når ferdig."
          status={backfillStateLine(backfillMeta)}
          buttonLabel="Kjør backfill-batch"
          action={backfillAction}
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
                        href={`/admin/jobs/${r.id}`}
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
