import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/app/admin/_components/status-badge";
import { fmtDateTime } from "@/lib/admin/flash";
import { DOMAIN_LABEL, jobDomain } from "@/lib/admin/jobs";

export type JobsTableRow = {
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

const TRIGGER_LABEL: Record<string, string> = {
  manual: "manuell",
  cron: "cron",
  "fast-forward": "drain",
};

function durationLabel(started: string, finished: string | null): string {
  if (!finished) return "—";
  const ms = new Date(finished).getTime() - new Date(started).getTime();
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 1000)} s`;
}

type Props = {
  rows: JobsTableRow[];
  // compact: dashboard embed — no Rader column, no error overflow text,
  // no progress bar (saves vertical space). Full: process-history table
  // — every column.
  mode?: "compact" | "full";
  emptyLabel?: string;
};

export function JobsTable({ rows, mode = "full", emptyLabel = "Ingen jobber ennå." }: Props) {
  const isCompact = mode === "compact";
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Jobb</TableHead>
            <TableHead>Domene</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Startet</TableHead>
            <TableHead>Varighet</TableHead>
            {!isCompact && <TableHead className="text-right">Rader</TableHead>}
            <TableHead>Trigger</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={isCompact ? 6 : 7}
                className="py-12 text-center text-muted-foreground"
              >
                {emptyLabel}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => {
              const isRunning = r.status === "running";
              const domain = jobDomain(r.name);
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">
                    <Link
                      href={`/admin/processes/${r.id}`}
                      className="underline decoration-dotted underline-offset-4 hover:opacity-80"
                    >
                      {r.name}
                    </Link>
                    {!isCompact && isRunning && r.current_step ? (
                      <div className="mt-1 max-w-md truncate text-[0.7rem] text-muted-foreground">
                        {r.current_step}
                      </div>
                    ) : null}
                    {!isCompact && isRunning ? (
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
                              ? {
                                  width: `${Math.min(100, Math.max(0, r.progress_pct))}%`,
                                }
                              : undefined
                          }
                        />
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-mono text-[0.65rem] uppercase tracking-wider">
                      {DOMAIN_LABEL[domain]}
                    </Badge>
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
                  {!isCompact && (
                    <TableCell className="text-right tabular-nums">
                      {r.rows_processed ?? "—"}
                    </TableCell>
                  )}
                  <TableCell className="text-xs text-muted-foreground">
                    <span className="font-mono uppercase tracking-wider">
                      {TRIGGER_LABEL[r.trigger] ?? r.trigger}
                    </span>
                    {!isCompact && r.error ? (
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
  );
}
