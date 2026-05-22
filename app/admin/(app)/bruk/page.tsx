// app/admin/(app)/bruk/page.tsx — /bruk pillar admin overview.
//
// Layout (top to bottom):
//   1. KPI strip (5 stat cards)
//   2. ★ Prominent "Last ned bekreftede svar (CSV)" card — one-click export
//   3. "Trenger oppfølging" — pending rows with send issues
//   4. Snapshot freshness + manual "Frisk opp nå" button
//   5. Resend deliverability summary
//   6. Recent 20 confirmations
//
// All numbers are read fresh from the DB on every render (no ISR cache —
// admin pages always show live state).

import Link from "next/link";
import { BarChart3, Download, ListChecks, RefreshCw, Table as TableIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { sbFetch } from "@/lib/admin/sb";
import { fmtDateTime } from "@/lib/admin/flash";

import {
  refreshBrukStatsAction,
  resendConfirmAdminAction,
  deleteResponseAdminAction,
} from "./actions";

export const dynamic = "force-dynamic";

type CountRow = { count: number };
type SnapshotRow = { computed_at: string };
type RecentRow = {
  id: number;
  email: string;
  confirmed_at: string | null;
  q1_bransje: string;
  q2_frequency: string;
};
type AttentionRow = {
  id: number;
  email: string;
  status: string;
  submitted_at: string;
  send_attempts: number;
  last_send_error: string | null;
};

function unwrapCount(rows: CountRow[] | { count: number } | null): number {
  if (!rows) return 0;
  if (Array.isArray(rows)) return rows[0]?.count ?? 0;
  return rows.count ?? 0;
}

function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 2) return email;
  return `${email.slice(0, 2)}***${email.slice(at)}`;
}

function rollingCutoffs(): {
  oneHourAgoIso: string;
  sevenDaysAgoIso: string;
  oneDayAgoIso: string;
} {
  const now = Date.now();
  return {
    oneHourAgoIso: new Date(now - 3600 * 1000).toISOString(),
    sevenDaysAgoIso: new Date(now - 7 * 24 * 3600 * 1000).toISOString(),
    oneDayAgoIso: new Date(now - 24 * 3600 * 1000).toISOString(),
  };
}

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function BrukOverviewPage({ searchParams }: Props) {
  const sp = await searchParams;
  const { oneHourAgoIso, sevenDaysAgoIso, oneDayAgoIso } = rollingCutoffs();

  const [
    totalConfirmed,
    totalPending,
    confirmed7d,
    confirmed24h,
    snapshotInfo,
    attentionRows,
    recentRows,
    weeklyPlusSnapshot,
    sendsLastHour,
    sendsLastHourFailed,
  ] = await Promise.all([
    sbFetch<CountRow[] | { count: number }>(
      `/bruk_responses?status=eq.confirmed&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => null),
    sbFetch<CountRow[] | { count: number }>(
      `/bruk_responses?status=eq.pending&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => null),
    sbFetch<CountRow[] | { count: number }>(
      `/bruk_responses?status=eq.confirmed&confirmed_at=gte.${encodeURIComponent(sevenDaysAgoIso)}&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => null),
    sbFetch<CountRow[] | { count: number }>(
      `/bruk_responses?status=eq.confirmed&confirmed_at=gte.${encodeURIComponent(oneDayAgoIso)}&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => null),
    sbFetch<SnapshotRow[]>(
      `/bruk_aggregate_snapshot?cut=eq.overall&select=computed_at&limit=1`,
      { service: true },
    ).catch(() => [] as SnapshotRow[]),
    sbFetch<AttentionRow[]>(
      // Pending rows that look stuck: ≥3 send attempts, OR no attempts +
      // submitted >1h ago (which means the initial send presumably failed
      // and we don't know why).
      `/bruk_responses?status=eq.pending&or=(send_attempts.gte.3,and(send_attempts.eq.0,submitted_at.lt.${encodeURIComponent(oneHourAgoIso)}))&select=id,email,status,submitted_at,send_attempts,last_send_error&order=submitted_at.asc&limit=20`,
      { service: true },
    ).catch(() => [] as AttentionRow[]),
    sbFetch<RecentRow[]>(
      `/bruk_responses?status=eq.confirmed&select=id,email,confirmed_at,q1_bransje,q2_frequency&order=confirmed_at.desc&limit=20`,
      { service: true },
    ).catch(() => [] as RecentRow[]),
    sbFetch<Array<{ bucket: string; confirmed_count: number }>>(
      `/bruk_aggregate_snapshot?cut=eq.by_q2_frequency&bucket=in.(daglig,ukentlig)&select=bucket,confirmed_count`,
      { service: true },
    ).catch(() => [] as Array<{ bucket: string; confirmed_count: number }>),
    sbFetch<CountRow[] | { count: number }>(
      `/bruk_responses?send_attempts=gte.1&submitted_at=gte.${encodeURIComponent(oneHourAgoIso)}&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => null),
    sbFetch<CountRow[] | { count: number }>(
      `/bruk_responses?last_send_error=not.is.null&submitted_at=gte.${encodeURIComponent(oneHourAgoIso)}&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => null),
  ]);

  const confirmedCount = unwrapCount(totalConfirmed);
  const pendingCount = unwrapCount(totalPending);
  const last7d = unwrapCount(confirmed7d);
  const last24h = unwrapCount(confirmed24h);
  const lastSnapshot = snapshotInfo?.[0]?.computed_at ?? null;
  const weeklyPlusCount = weeklyPlusSnapshot.reduce(
    (acc, r) => acc + r.confirmed_count,
    0,
  );
  const weeklyPlusPct =
    confirmedCount > 0
      ? Math.round((weeklyPlusCount / confirmedCount) * 100)
      : null;
  const sendsHour = unwrapCount(sendsLastHour);
  const sendsHourFailed = unwrapCount(sendsLastHourFailed);

  return (
    <>
      <PageHeader
        eyebrow="Bruk"
        title="Oversikt"
        description="Selvrapportert AI-bruk i Norge. Bekreftede respondenter, ventende rader, Resend-helse og aggregert snapshot-status."
      />

      <Flash searchParams={sp} />

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard
          label="Bekreftede svar"
          value={new Intl.NumberFormat("nb-NO").format(confirmedCount)}
        />
        <StatCard
          label="Ventende"
          value={new Intl.NumberFormat("nb-NO").format(pendingCount)}
          hint={
            pendingCount > 0 ? "venter på e-postbekreftelse" : "ingen i kø"
          }
        />
        <StatCard
          label="Siste 7 dager"
          value={new Intl.NumberFormat("nb-NO").format(last7d)}
          hint={`${new Intl.NumberFormat("nb-NO").format(last24h)} siste 24 t`}
        />
        <StatCard
          label="Ukentlig+"
          value={weeklyPlusPct === null ? "—" : `${weeklyPlusPct} %`}
          hint="bruker AI minst ukentlig"
        />
        <StatCard
          label="Resend siste time"
          value={`${sendsHour - sendsHourFailed} / ${sendsHour}`}
          hint={
            sendsHourFailed > 0
              ? `${sendsHourFailed} feilet`
              : sendsHour > 0
                ? "alle vellykket"
                : "ingen aktivitet"
          }
          className={sendsHourFailed > 0 ? "border-destructive/50" : undefined}
        />
      </div>

      {/* ★ Prominent CSV export card */}
      <Card className="mt-6 border-2 border-primary/40 bg-primary/[0.03]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="size-4" />
            Last ned bekreftede svar (CSV)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            {new Intl.NumberFormat("nb-NO").format(confirmedCount)} bekreftede
            respondenter. CSV-en inneholder e-postadresse, bransje og
            survey-svar — ingen hashes eller tokens.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <a
                href="/admin/api/bruk/export-confirmed.csv"
                download
              >
                <Download className="size-4" /> Last ned CSV
              </a>
            </Button>
            <Button asChild variant="outline">
              <Link href="/admin/bruk/responses?status=confirmed">
                <TableIcon className="size-4" /> Se i tabell
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Trenger oppfølging */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="size-4" />
            Trenger oppfølging
            {attentionRows.length > 0 ? (
              <span className="rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                {attentionRows.length}
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {attentionRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ingen ventende rader trenger oppfølging.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Innsendt</TableHead>
                  <TableHead>E-post</TableHead>
                  <TableHead>Forsøk</TableHead>
                  <TableHead>Feil</TableHead>
                  <TableHead className="text-right">Handlinger</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attentionRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {fmtDateTime(r.submitted_at)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {maskEmail(r.email)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {r.send_attempts}
                    </TableCell>
                    <TableCell className="max-w-[24ch] truncate text-xs text-muted-foreground" title={r.last_send_error ?? ""}>
                      {r.last_send_error ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-2">
                        <form action={resendConfirmAdminAction}>
                          <input type="hidden" name="id" value={r.id} />
                          <Button type="submit" size="sm" variant="outline">
                            Send på nytt
                          </Button>
                        </form>
                        <form action={deleteResponseAdminAction}>
                          <input type="hidden" name="id" value={r.id} />
                          <Button
                            type="submit"
                            size="sm"
                            variant="destructive"
                          >
                            Slett
                          </Button>
                        </form>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Snapshot freshness */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="size-4" />
            Statistikk-snapshot
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="text-sm text-muted-foreground">
              {lastSnapshot ? (
                <>
                  Sist oppfrisket{" "}
                  <span className="text-foreground">
                    {fmtDateTime(lastSnapshot)}
                  </span>
                </>
              ) : (
                <>Snapshot er ikke generert ennå.</>
              )}
              <span className="ml-3 text-xs">
                Cron tikker hvert 15. minutt (
                <code>bruk-refresh-stats</code>).
              </span>
            </div>
            <form action={refreshBrukStatsAction}>
              <Button type="submit" variant="outline">
                <RefreshCw className="size-4" /> Frisk opp nå
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>

      {/* Recent confirmations */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Siste 20 bekreftelser</CardTitle>
        </CardHeader>
        <CardContent>
          {recentRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ingen bekreftede svar ennå.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bekreftet</TableHead>
                  <TableHead>E-post</TableHead>
                  <TableHead>Bransje</TableHead>
                  <TableHead>Hyppighet</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {fmtDateTime(r.confirmed_at)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {maskEmail(r.email)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.q1_bransje === "privatperson"
                        ? "Privatperson"
                        : r.q1_bransje}
                    </TableCell>
                    <TableCell className="text-xs">{r.q2_frequency}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
