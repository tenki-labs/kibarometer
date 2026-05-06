import Link from "next/link";
import { AlertTriangle, ArrowLeft, RefreshCcw, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { SubmitButton } from "@/app/admin/_components/submit-button";
import { fmtDateTime } from "@/lib/admin/flash";
import { sbFetch } from "@/lib/admin/sb";
import { discardOldFailedAction, retryQueueAction } from "./actions";

export const dynamic = "force-dynamic";

type CountRow = { count: number };

type QueueRow = {
  id: string;
  url: string;
  status: string;
  attempts: number;
  discovered_at: string;
  last_error: string | null;
  source: { name: string; domain: string } | null;
};

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function unwrapCount(rows: CountRow[] | { count: number } | null): number {
  if (!rows) return 0;
  if (Array.isArray(rows)) return rows[0]?.count ?? 0;
  return rows.count ?? 0;
}

export default async function MediaQueuePage({ searchParams }: Props) {
  const sp = await searchParams;

  const [pending, fetched, failedCount, skipped, oldestPending, recentFailures] =
    await Promise.all([
      sbFetch<CountRow[] | { count: number }>(
        `/media_url_queue?status=eq.pending&select=count`,
        { service: true, headers: { Prefer: "count=exact" } },
      ).catch(() => null),
      sbFetch<CountRow[] | { count: number }>(
        `/media_url_queue?status=eq.fetched&select=count`,
        { service: true, headers: { Prefer: "count=exact" } },
      ).catch(() => null),
      sbFetch<CountRow[] | { count: number }>(
        `/media_url_queue?status=eq.failed&select=count`,
        { service: true, headers: { Prefer: "count=exact" } },
      ).catch(() => null),
      sbFetch<CountRow[] | { count: number }>(
        `/media_url_queue?status=eq.skipped_keyword&select=count`,
        { service: true, headers: { Prefer: "count=exact" } },
      ).catch(() => null),
      sbFetch<{ discovered_at: string }[]>(
        `/media_url_queue?status=eq.pending&order=discovered_at.asc&limit=1` +
          `&select=discovered_at`,
        { service: true },
      ).catch(() => []),
      sbFetch<QueueRow[]>(
        `/media_url_queue?status=eq.failed&order=discovered_at.desc&limit=50` +
          `&select=id,url,status,attempts,discovered_at,last_error,` +
          `source:media_sources(name,domain)`,
        { service: true },
      ).catch(() => [] as QueueRow[]),
    ]);

  const pendingCount = unwrapCount(pending);
  const fetchedCount = unwrapCount(fetched);
  const failed = unwrapCount(failedCount);
  const skippedCount = unwrapCount(skipped);
  const oldest = oldestPending[0]?.discovered_at;

  return (
    <>
      <Flash searchParams={sp} />
      <PageHeader
        eyebrow="Mediedekning"
        title="Kø"
        description="Operativ tilstand for media_url_queue. Pending = venter på fetch+klassifiser. Failed = HTTP/parse-feil etter 3 forsøk."
        action={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/admin/media">
                <ArrowLeft />
                Tilbake
              </Link>
            </Button>
            <form action={discardOldFailedAction}>
              <SubmitButton variant="outline" pendingLabel="Sletter…">
                <Trash2 />
                Slett feilede {">"} 7 dager
              </SubmitButton>
            </form>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Pending"
          value={pendingCount.toLocaleString("nb-NO")}
          hint={oldest ? `Eldste: ${fmtDateTime(oldest)}` : "Tom"}
        />
        <StatCard
          label="Fetched"
          value={fetchedCount.toLocaleString("nb-NO")}
          hint="Lagt inn i media_articles"
        />
        <StatCard
          label="Failed"
          value={failed.toLocaleString("nb-NO")}
          hint={failed > 0 ? "Sjekk feilmeldinger nedenfor" : "Ingen feil"}
        />
        <StatCard
          label="Skipped"
          value={skippedCount.toLocaleString("nb-NO")}
          hint="Filtrert i Stage 2 (negativ cache)"
        />
      </div>

      <Card className="mt-6 gap-0 p-0">
        <CardHeader className="px-6 py-4">
          <CardTitle className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.14em]">
            <AlertTriangle className="size-4" />
            Siste 50 feilede rader
          </CardTitle>
          <CardDescription className="mt-1">
            Trykk &quot;Re-kø&quot; for å nullstille forsøk og legge URL-en
            tilbake i pending. URL-er som 404er permanent slettes via knappen
            øverst etter 7 dager.
          </CardDescription>
        </CardHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>URL</TableHead>
                <TableHead>Kilde</TableHead>
                <TableHead className="text-right">Forsøk</TableHead>
                <TableHead>Oppdaget</TableHead>
                <TableHead>Feil</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentFailures.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-12 text-center text-muted-foreground"
                  >
                    Ingen feilede rader. {failed === 0 ? "Køen er sunn." : null}
                  </TableCell>
                </TableRow>
              ) : (
                recentFailures.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="max-w-md truncate font-mono text-[0.7rem]">
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline decoration-dotted underline-offset-4 hover:opacity-80"
                      >
                        {r.url}
                      </a>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.source?.name ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <Badge variant="outline" className="font-mono text-[0.65rem]">
                        {r.attempts}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {fmtDateTime(r.discovered_at)}
                    </TableCell>
                    <TableCell className="max-w-sm truncate text-xs text-rose-600 dark:text-rose-400">
                      {r.last_error ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <form action={retryQueueAction.bind(null, r.id)}>
                        <SubmitButton variant="outline" size="sm" pendingLabel="…">
                          <RefreshCcw />
                          Re-kø
                        </SubmitButton>
                      </form>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </>
  );
}
