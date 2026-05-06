import Link from "next/link";

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
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Flash } from "@/app/admin/_components/flash";
import { PageHeader } from "@/app/admin/_components/page-header";
import { StatCard } from "@/app/admin/_components/stat-card";
import { SubmitButton } from "@/app/admin/_components/submit-button";
import { sbFetch } from "@/lib/admin/sb";

import {
  discardFailedAction,
  retryFailedAction,
  rolesBurstAction,
} from "./actions";

export const dynamic = "force-dynamic";

type QueueRow = {
  orgnr: string;
  status: string;
  enqueued_at: string;
  attempts: number;
  last_error: string | null;
};

type CountRow = { count: number };

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function countRows(filter: string): Promise<number> {
  try {
    const r = await sbFetch<CountRow[]>(`/brreg_url_queue?select=count&${filter}`, {
      service: true,
    });
    return r?.[0]?.count ?? 0;
  } catch {
    return 0;
  }
}

export default async function QueuePage({ searchParams }: Props) {
  const params = await searchParams;

  const [pending, fetched, failed, oldestPending, recentFailed] = await Promise.all([
    countRows("status=eq.pending"),
    countRows("status=eq.fetched"),
    countRows("status=eq.failed"),
    sbFetch<QueueRow[]>(
      "/brreg_url_queue?status=eq.pending&order=enqueued_at.asc&limit=10&select=orgnr,status,enqueued_at,attempts,last_error",
      { service: true },
    ).catch(() => [] as QueueRow[]),
    sbFetch<QueueRow[]>(
      "/brreg_url_queue?status=eq.failed&order=enqueued_at.desc&limit=20&select=orgnr,status,enqueued_at,attempts,last_error",
      { service: true },
    ).catch(() => [] as QueueRow[]),
  ]);

  return (
    <>
      <Flash searchParams={params} />
      <PageHeader
        eyebrow="Innsikt · Oppstart"
        title="Rolle-kø"
        description={
          <>
            Innsikt i brreg_url_queue. Rader genereres når et nytt foretak
            havner i en kategori med <code className="text-xs">enrich_roles=true</code>.
            Cron drenerer K=50 hvert 30. min;{" "}
            <Link href="/admin/startups" className="underline underline-offset-2">
              burst-knappen
            </Link>{" "}
            kjører K=500.
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Ventende" value={pending.toLocaleString("nb-NO")} />
        <StatCard label="Hentet" value={fetched.toLocaleString("nb-NO")} />
        <StatCard
          label="Feilet"
          value={failed.toLocaleString("nb-NO")}
          hint="Etter 3 forsøk fryses raden som 'failed'."
        />
      </div>

      <Card className="mt-6 gap-3">
        <CardHeader>
          <CardTitle className="font-mono text-[0.7rem] uppercase tracking-[0.14em]">
            Manuell drainer
          </CardTitle>
          <CardDescription>
            Burst-drain av rolle-køen (K=500 / 4-min budget) — samme
            orchestrator som <code className="font-mono">brreg-roles</code>{" "}
            cron, bare større batch. Bruk når du har en pukkel etter
            backfill og ikke vil vente på neste tikk.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={rolesBurstAction}>
            <SubmitButton
              variant="outline"
              size="sm"
              pendingLabel="Starter…"
              disabled={pending === 0}
            >
              Tøm rollekø ({pending.toLocaleString("nb-NO")})
            </SubmitButton>
          </form>
        </CardContent>
      </Card>

      {failed > 0 && (
        <Card className="mt-6 border-rose-200 dark:border-rose-900">
          <CardHeader>
            <CardTitle className="text-base">Feilede rader</CardTitle>
            <CardDescription>
              Tilbakestill (sett status=pending, nullstill attempts) eller forkast.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex flex-wrap gap-2">
              <form action={retryFailedAction}>
                <SubmitButton size="sm" variant="outline" pendingLabel="Tilbakestiller…">
                  Tilbakestill alle feilede
                </SubmitButton>
              </form>
              <form action={discardFailedAction}>
                <SubmitButton size="sm" variant="outline" pendingLabel="Forkaster…">
                  Forkast alle feilede
                </SubmitButton>
              </form>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Orgnr</TableHead>
                  <TableHead className="text-right tabular-nums">Forsøk</TableHead>
                  <TableHead className="tabular-nums">Lagt i kø</TableHead>
                  <TableHead>Siste feil</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentFailed.map((r) => (
                  <TableRow key={r.orgnr}>
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/admin/startups/companies/${encodeURIComponent(r.orgnr)}`}
                        className="hover:underline"
                      >
                        {r.orgnr}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs">
                      {r.attempts}
                    </TableCell>
                    <TableCell className="tabular-nums text-xs text-muted-foreground">
                      {new Date(r.enqueued_at).toLocaleString("nb-NO")}
                    </TableCell>
                    <TableCell className="max-w-[40ch] truncate text-xs">
                      {r.last_error || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Eldste ventende</CardTitle>
          <CardDescription>De 10 lengst-ventende radene først.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Orgnr</TableHead>
                <TableHead className="tabular-nums">Lagt i kø</TableHead>
                <TableHead className="text-right tabular-nums">Forsøk</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {oldestPending.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                    Køen er tom.
                  </TableCell>
                </TableRow>
              ) : (
                oldestPending.map((r) => (
                  <TableRow key={r.orgnr}>
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/admin/startups/companies/${encodeURIComponent(r.orgnr)}`}
                        className="hover:underline"
                      >
                        {r.orgnr}
                      </Link>
                    </TableCell>
                    <TableCell className="tabular-nums text-xs text-muted-foreground">
                      {new Date(r.enqueued_at).toLocaleString("nb-NO")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs">
                      {r.attempts}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
