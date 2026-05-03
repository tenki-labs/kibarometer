import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Flash } from "@/app/admin/_components/flash";
import { PageHeader } from "@/app/admin/_components/page-header";
import { StatCard } from "@/app/admin/_components/stat-card";
import { StatusBadge } from "@/app/admin/_components/status-badge";
import { sbFetch } from "@/lib/admin/sb";
import { fmtDateTime } from "@/lib/admin/flash";

type JobRow = {
  id: string;
  name: string;
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  rows_processed: number | null;
  error: string | null;
  metadata: Record<string, unknown> | null;
  progress_pct: number | null;
  current_step: string | null;
  last_heartbeat: string | null;
};

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ${Math.floor((ms % 60_000) / 1000)} s`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h} t ${m} min`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 ? 2 : 1)} ${units[i]}`;
}

function heartbeatFreshness(
  last: string | null,
): { label: string; tone: "green" | "yellow" | "red" | "muted" } {
  if (!last) return { label: "ingen", tone: "muted" };
  const ageMs = Date.now() - new Date(last).getTime();
  if (ageMs < 30_000) return { label: `${Math.round(ageMs / 1000)} s siden`, tone: "green" };
  if (ageMs < 120_000) return { label: `${Math.round(ageMs / 1000)} s siden`, tone: "yellow" };
  if (ageMs < 3_600_000) return { label: `${Math.round(ageMs / 60_000)} min siden`, tone: "red" };
  return { label: fmtDateTime(last), tone: "red" };
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
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";

export default async function JobDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;

  const rows = await sbFetch<JobRow[]>(
    `/jobs?id=eq.${encodeURIComponent(id)}&select=id,name,trigger,status,started_at,finished_at,rows_processed,error,metadata,progress_pct,current_step,last_heartbeat`,
    { service: true },
  );
  const row = rows[0];

  if (!row) {
    return (
      <>
        <Flash searchParams={sp} />
        <PageHeader
          eyebrow="Drift"
          title="Jobb ikke funnet"
          action={
            <Button asChild variant="outline">
              <Link href="/admin/jobs">
                <ArrowLeft />
                Tilbake
              </Link>
            </Button>
          }
        />
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Ingen jobb med id <code className="font-mono">{id}</code>.
          </CardContent>
        </Card>
      </>
    );
  }

  const isRunning = row.status === "running";
  const startedAt = new Date(row.started_at);
  const endedAt = row.finished_at ? new Date(row.finished_at) : new Date();
  const elapsedMs = endedAt.getTime() - startedAt.getTime();
  const pct = row.progress_pct ?? null;
  const etaMs =
    isRunning && pct != null && pct > 0 && pct < 100
      ? Math.round((elapsedMs * (100 - pct)) / pct)
      : null;

  const fresh = heartbeatFreshness(row.last_heartbeat);
  const mem = process.memoryUsage();

  return (
    <>
      {isRunning ? <meta httpEquiv="refresh" content="3" /> : null}
      <Flash searchParams={sp} />
      <PageHeader
        eyebrow="Drift"
        title={row.name}
        description={
          <>
            <code className="font-mono text-xs">{row.id}</code> ·{" "}
            <span className="font-mono uppercase tracking-wider">
              {row.trigger}
            </span>{" "}
            · startet {fmtDateTime(row.started_at)}
          </>
        }
        action={
          <Button asChild variant="ghost">
            <Link href="/admin/jobs">
              <ArrowLeft />
              Tilbake
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Status"
          value={<StatusBadge status={row.status} />}
          hint={
            isRunning
              ? "Auto-oppdaterer hvert 3. sekund"
              : `Avsluttet ${fmtDateTime(row.finished_at)}`
          }
        />
        <StatCard
          label="Forløpt"
          value={formatElapsed(elapsedMs)}
          hint={isRunning ? "siden start" : "totalt"}
        />
        <StatCard
          label="ETA"
          value={
            etaMs != null
              ? formatElapsed(etaMs)
              : isRunning
                ? "—"
                : "ferdig"
          }
          hint={
            etaMs != null
              ? "basert på framdrift så langt"
              : isRunning
                ? "framdrift ikke tilgjengelig"
                : null
          }
        />
        <StatCard
          label="Rader"
          value={row.rows_processed ?? "—"}
          hint={
            row.rows_processed != null
              ? "behandlet"
              : isRunning
                ? "telles ved ferdig"
                : "ingen"
          }
        />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="font-mono text-xs uppercase tracking-[0.18em]">
            Framdrift
          </CardTitle>
          <CardDescription>
            {row.current_step ?? (isRunning ? "ingen steg-info ennå" : "—")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            {/* Bar: bg = container, fill = colored. pct null → indeterminate
                stripes via background gradient on the fill. */}
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
                style={pct != null ? { width: `${Math.min(100, Math.max(0, pct))}%` } : undefined}
              />
            </div>
            <div className="w-16 text-right font-mono text-sm tabular-nums">
              {pct != null ? `${pct.toFixed(0)}%` : "—"}
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Heartbeat:</span>
            <Badge
              variant="outline"
              className={`font-mono text-[0.65rem] ${TONE_CLASS[fresh.tone]}`}
            >
              {fresh.label}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {row.error ? (
        <Card className="mt-6 border-destructive">
          <CardHeader>
            <CardTitle className="font-mono text-xs uppercase tracking-[0.18em] text-destructive">
              Feil
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap break-words font-mono text-xs">
              {row.error}
            </pre>
          </CardContent>
        </Card>
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-xs uppercase tracking-[0.18em]">
              Tidslinje
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                <Row label="Startet" value={fmtDateTime(row.started_at)} />
                <Row label="Avsluttet" value={fmtDateTime(row.finished_at)} />
                <Row
                  label="Siste heartbeat"
                  value={fmtDateTime(row.last_heartbeat)}
                />
                <Row label="Trigger" value={row.trigger} />
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-xs uppercase tracking-[0.18em]">
              kiba-web nå
            </CardTitle>
            <CardDescription>
              Snapshot ved sideinnlasting. Detaljer på{" "}
              <code className="font-mono text-xs">/admin/diagnostics</code>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                <Row label="RSS" value={formatBytes(mem.rss)} />
                <Row label="Heap brukt" value={formatBytes(mem.heapUsed)} />
                <Row
                  label="Heap totalt"
                  value={formatBytes(mem.heapTotal)}
                />
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {row.metadata && Object.keys(row.metadata).length > 0 ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="font-mono text-xs uppercase tracking-[0.18em]">
              Metadata
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
              {JSON.stringify(row.metadata, null, 2)}
            </pre>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <TableRow>
      <TableCell className="text-xs text-muted-foreground">{label}</TableCell>
      <TableCell className="text-right font-mono text-xs">{value}</TableCell>
    </TableRow>
  );
}
