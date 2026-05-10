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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Flash } from "@/app/admin/_components/flash";
import { PageHeader } from "@/app/admin/_components/page-header";
import { StatCard } from "@/app/admin/_components/stat-card";
import { SubmitButton } from "@/app/admin/_components/submit-button";
import { sbFetch } from "@/lib/admin/sb";

import {
  discardFailedAction,
  retryFailedAction,
  rolesBurstAction,
  stopRolesDrainAction,
} from "./actions";
import {
  backfillAction,
  ingestAction,
  refreshSnapshotsAction,
  reprocessKeywordsAction,
  runTier1Action,
  runTier2Action,
  stopReprocessAction,
} from "../actions";

export const dynamic = "force-dynamic";

type QueueRow = {
  orgnr: string;
  status: string;
  enqueued_at: string;
  attempts: number;
  last_error: string | null;
};

type CountRow = { count: number };

type ReprocessDrainRow = {
  id: string;
  status: string;
  current_step: string | null;
};

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function countRows(table: string, filter = ""): Promise<number> {
  try {
    const r = await sbFetch<CountRow[]>(
      `/${table}?select=count${filter ? `&${filter}` : ""}`,
      { service: true },
    );
    return r?.[0]?.count ?? 0;
  } catch {
    return 0;
  }
}

// Hoisted out of the component for react-hooks/purity.
function yesterdayIso(): string {
  return new Date(Date.now() - 86400000).toISOString().slice(0, 10);
}

export default async function QueuePage({ searchParams }: Props) {
  const params = await searchParams;
  const yesterday = yesterdayIso();

  const [
    pending,
    fetched,
    failed,
    tier1Pending,
    tier2Pending,
    oldestPending,
    recentFailed,
    reprocessDrain,
    rolesDrain,
  ] = await Promise.all([
    countRows("brreg_url_queue", "status=eq.pending"),
    countRows("brreg_url_queue", "status=eq.fetched"),
    countRows("brreg_url_queue", "status=eq.failed"),
    countRows(
      "brreg_companies",
      "is_ai_relevant=is.true&tier1_completed_at=is.null&llm_retry_count=lt.3&ingest_mode=eq.live",
    ),
    countRows(
      "brreg_companies",
      "is_ai_relevant=is.true&tier1_completed_at=not.is.null&tier2_completed_at=is.null&llm_retry_count=lt.3",
    ),
    sbFetch<QueueRow[]>(
      "/brreg_url_queue?status=eq.pending&order=enqueued_at.asc&limit=10&select=orgnr,status,enqueued_at,attempts,last_error",
      { service: true },
    ).catch(() => [] as QueueRow[]),
    sbFetch<QueueRow[]>(
      "/brreg_url_queue?status=eq.failed&order=enqueued_at.desc&limit=20&select=orgnr,status,enqueued_at,attempts,last_error",
      { service: true },
    ).catch(() => [] as QueueRow[]),
    sbFetch<ReprocessDrainRow[]>(
      "/jobs?name=eq.brreg_reprocess_drain&order=started_at.desc&limit=1&select=id,status,current_step",
      { service: true },
    ).catch(() => [] as ReprocessDrainRow[]),
    sbFetch<ReprocessDrainRow[]>(
      "/jobs?name=eq.enrich_brreg_roles_drain&order=started_at.desc&limit=1&select=id,status,current_step",
      { service: true },
    ).catch(() => [] as ReprocessDrainRow[]),
  ]);

  const reprocessRunning = reprocessDrain[0]?.status === "running";
  const reprocessStep = reprocessDrain[0]?.current_step ?? null;
  const rolesDrainRunning = rolesDrain[0]?.status === "running";
  const rolesDrainStep = rolesDrain[0]?.current_step ?? null;

  return (
    <>
      <Flash searchParams={params} />
      <PageHeader
        eyebrow="Innsikt · Oppstart"
        title="Kø"
        description={
          <>
            Operativ tilstand for brreg-pipelinen: rolle-fetch-køen og
            LLM-tier-køene. Cron drenerer normaltilstand;{" "}
            <em>Operasjoner</em> nedenfor er escape hatches.
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Rolle-kø ventende"
          value={pending.toLocaleString("nb-NO")}
          hint="Cron K=50 hver halvtime"
        />
        <StatCard
          label="Rolle-kø hentet"
          value={fetched.toLocaleString("nb-NO")}
          hint="Lagt i brreg_roles"
        />
        <StatCard
          label="Rolle-kø feilet"
          value={failed.toLocaleString("nb-NO")}
          hint={failed > 0 ? "Sjekk feilmeldinger nedenfor" : "Ingen feil"}
        />
        <StatCard
          label="Tier 1-kø"
          value={tier1Pending.toLocaleString("nb-NO")}
          hint="AI-relevante selskaper uten T1"
        />
      </div>

      <Card className="mt-6 gap-3">
        <CardHeader>
          <CardTitle className="font-mono text-[0.7rem] uppercase tracking-[0.14em]">
            Operasjoner
          </CardTitle>
          <CardDescription>
            De fem essensielle knappene for brreg-pipelinen. Cron dekker
            normaltilstand — bruk når du vil verifisere et taksonomi-skifte
            eller drainere en backlog. Backfill laster hele Brreg-registeret
            via bulk-dump; den lille datovinduet under er for inkrementell
            ingest (samme som daglig cron).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <form action={reprocessKeywordsAction}>
              <SubmitButton
                variant="outline"
                size="sm"
                pendingLabel="Starter…"
                disabled={reprocessRunning}
              >
                {reprocessRunning ? "Keyword-mapping kjører…" : "Keyword-mapping"}
              </SubmitButton>
            </form>
            {reprocessRunning ? (
              <form action={stopReprocessAction}>
                <SubmitButton variant="outline" size="sm" pendingLabel="Stopper…">
                  Stopp keyword-mapping
                </SubmitButton>
              </form>
            ) : null}
            <form action={backfillAction}>
              <SubmitButton variant="outline" size="sm" pendingLabel="Starter…">
                Backfill (hele registeret)
              </SubmitButton>
            </form>
            <form action={runTier1Action}>
              <SubmitButton
                variant="outline"
                size="sm"
                pendingLabel="Starter…"
                disabled={tier1Pending === 0}
              >
                Kjør Tier 1 ({tier1Pending.toLocaleString("nb-NO")})
              </SubmitButton>
            </form>
            <form action={runTier2Action}>
              <SubmitButton
                variant="outline"
                size="sm"
                pendingLabel="Starter…"
                disabled={tier2Pending === 0}
              >
                Kjør Tier 2 ({tier2Pending.toLocaleString("nb-NO")})
              </SubmitButton>
            </form>
            <form action={refreshSnapshotsAction}>
              <SubmitButton variant="outline" size="sm" pendingLabel="Regner…">
                Refresh snapshots
              </SubmitButton>
            </form>
            <form action={rolesBurstAction}>
              <SubmitButton
                variant="outline"
                size="sm"
                pendingLabel="Starter…"
                disabled={pending === 0 || rolesDrainRunning}
              >
                {rolesDrainRunning
                  ? "Rolle-drainering kjører…"
                  : `Hent roller nå (${pending.toLocaleString("nb-NO")})`}
              </SubmitButton>
            </form>
            {rolesDrainRunning ? (
              <form action={stopRolesDrainAction}>
                <SubmitButton variant="outline" size="sm" pendingLabel="Stopper…">
                  Stopp drainering
                </SubmitButton>
              </form>
            ) : null}
          </div>

          {reprocessRunning && reprocessStep ? (
            <p className="text-xs text-muted-foreground">
              Keyword-mapping: {reprocessStep}
            </p>
          ) : null}

          {rolesDrainRunning && rolesDrainStep ? (
            <p className="text-xs text-muted-foreground">
              Rolle-drainering: {rolesDrainStep}
            </p>
          ) : null}

          <details className="mt-1 rounded-md border bg-muted/30 px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              Inkrementell ingest (dato-vindu)
            </summary>
            <form action={ingestAction} className="mt-3 flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                Hent foretak fra brreg-API for et dato-vindu. Tomme felt =
                gårsdagen. Idempotent på orgnr. Cron kjører dette daglig
                06:30 UTC.
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <Label htmlFor="ingest-from" className="text-xs">
                    Fra (YYYY-MM-DD)
                  </Label>
                  <Input id="ingest-from" name="from" placeholder={yesterday} />
                </div>
                <div>
                  <Label htmlFor="ingest-to" className="text-xs">
                    Til
                  </Label>
                  <Input id="ingest-to" name="to" placeholder={yesterday} />
                </div>
              </div>
              <SubmitButton size="sm" pendingLabel="Henter…" className="self-start">
                Ingest
              </SubmitButton>
            </form>
          </details>
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
