// app/admin/(app)/bruk/stats/page.tsx — admin-only statistics view.
//
// Shows the same aggregate cuts as the public /bruk page (different
// presentation — tabular, absolute counts emphasized) plus admin-only
// metrics that the public never sees: confirmation funnel rate, oldest
// pending row, email-domain distribution.

import { RefreshCw } from "lucide-react";

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
import { fmtDateTime } from "@/lib/admin/flash";
import { sbFetch } from "@/lib/admin/sb";

import { refreshBrukStatsAction } from "../actions";

export const dynamic = "force-dynamic";

type AggregateRow = {
  cut: string;
  bucket: string;
  confirmed_count: number;
  share_pct: number | null;
  computed_at: string;
};

type CountRow = { count: number };
type EmailRow = { email: string };
type PendingRow = { submitted_at: string; email: string; send_attempts: number };
type ConfirmedDelta = { submitted_at: string; confirmed_at: string };

function unwrapCount(rows: CountRow[] | { count: number } | null): number {
  if (!rows) return 0;
  if (Array.isArray(rows)) return rows[0]?.count ?? 0;
  return rows.count ?? 0;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function formatDurationMinutes(min: number): string {
  if (min < 60) return `${Math.round(min)} min`;
  const hours = min / 60;
  if (hours < 24) return `${hours.toFixed(1)} t`;
  return `${(hours / 24).toFixed(1)} dager`;
}

function currentTimestamp(): number {
  return Date.now();
}

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function BrukStatsPage({ searchParams }: Props) {
  const sp = await searchParams;

  const [aggregateRows, totalConfirmed, totalExpired, pendingRows, confirmedDeltas, emailRows] =
    await Promise.all([
      sbFetch<AggregateRow[]>(
        "/bruk_aggregate_snapshot?select=cut,bucket,confirmed_count,share_pct,computed_at&order=cut.asc,confirmed_count.desc",
        { service: true },
      ).catch(() => [] as AggregateRow[]),
      sbFetch<CountRow[] | { count: number }>(
        "/bruk_responses?status=eq.confirmed&select=count",
        { service: true, headers: { Prefer: "count=exact" } },
      ).catch(() => null),
      sbFetch<CountRow[] | { count: number }>(
        "/bruk_responses?status=eq.expired&select=count",
        { service: true, headers: { Prefer: "count=exact" } },
      ).catch(() => null),
      sbFetch<PendingRow[]>(
        "/bruk_responses?status=eq.pending&select=submitted_at,email,send_attempts&order=submitted_at.asc&limit=200",
        { service: true },
      ).catch(() => [] as PendingRow[]),
      sbFetch<ConfirmedDelta[]>(
        "/bruk_responses?status=eq.confirmed&select=submitted_at,confirmed_at&order=confirmed_at.desc&limit=500",
        { service: true },
      ).catch(() => [] as ConfirmedDelta[]),
      sbFetch<EmailRow[]>(
        "/bruk_responses?status=eq.confirmed&select=email&limit=2000",
        { service: true },
      ).catch(() => [] as EmailRow[]),
    ]);

  // Bucket aggregate rows by cut.
  const byCut = new Map<string, AggregateRow[]>();
  for (const r of aggregateRows) {
    const list = byCut.get(r.cut) ?? [];
    list.push(r);
    byCut.set(r.cut, list);
  }

  const confirmed = unwrapCount(totalConfirmed);
  const expired = unwrapCount(totalExpired);
  const funnelDenom = confirmed + expired;
  const funnelPct =
    funnelDenom > 0 ? Math.round((confirmed / funnelDenom) * 100) : null;

  // Time-to-confirm: median of (confirmed_at - submitted_at) in minutes.
  const deltasMin: number[] = [];
  for (const d of confirmedDeltas) {
    const a = new Date(d.submitted_at).getTime();
    const b = new Date(d.confirmed_at).getTime();
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) {
      deltasMin.push((b - a) / 60_000);
    }
  }
  const medianTtc = median(deltasMin);

  // Pending row age distribution.
  const now = currentTimestamp();
  const ageBuckets = { under1h: 0, under24h: 0, under7d: 0, older: 0 };
  let oldestPending: string | null = null;
  for (const p of pendingRows) {
    const ageHr = (now - new Date(p.submitted_at).getTime()) / 3_600_000;
    if (ageHr < 1) ageBuckets.under1h++;
    else if (ageHr < 24) ageBuckets.under24h++;
    else if (ageHr < 24 * 7) ageBuckets.under7d++;
    else ageBuckets.older++;
    if (!oldestPending || p.submitted_at < oldestPending) {
      oldestPending = p.submitted_at;
    }
  }

  // Email-domain breakdown (top 10).
  const domainCount = new Map<string, number>();
  for (const r of emailRows) {
    const at = r.email.lastIndexOf("@");
    if (at < 0) continue;
    const domain = r.email.slice(at + 1).toLowerCase();
    domainCount.set(domain, (domainCount.get(domain) ?? 0) + 1);
  }
  const topDomains = Array.from(domainCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const domainCappedSample = emailRows.length;

  return (
    <>
      <PageHeader
        eyebrow="Bruk"
        title="Statistikk"
        description="Aggregert snapshot pluss admin-spesifikke metrikker: konfirmasjonsrate, tid-til-bekreftelse, e-postdomener og aldersfordeling av ventende."
        action={
          <form action={refreshBrukStatsAction}>
            <Button type="submit" variant="outline">
              <RefreshCw className="size-4" /> Frisk opp snapshot
            </Button>
          </form>
        }
      />

      <Flash searchParams={sp} />

      {/* Admin-only KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Konfirmasjonsrate"
          value={funnelPct === null ? "—" : `${funnelPct} %`}
          hint={`${confirmed} bekreftet av ${funnelDenom} (bekreftet + utløpt)`}
        />
        <StatCard
          label="Median tid til bekreftelse"
          value={medianTtc === null ? "—" : formatDurationMinutes(medianTtc)}
          hint={`basert på ${deltasMin.length} svar`}
        />
        <StatCard
          label="Eldste ventende"
          value={oldestPending ? fmtDateTime(oldestPending) : "—"}
          hint={`${pendingRows.length} ventende totalt`}
        />
        <StatCard
          label="Unike e-postdomener"
          value={new Intl.NumberFormat("nb-NO").format(domainCount.size)}
          hint={`av ${domainCappedSample} bekreftede svar`}
        />
      </div>

      {/* Pending age distribution */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Aldersfordeling av ventende</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Alder</TableHead>
                <TableHead className="text-right">Antall</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>{"< 1 time"}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {ageBuckets.under1h}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>{"1 – 24 timer"}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {ageBuckets.under24h}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>{"1 – 7 dager"}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {ageBuckets.under7d}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>{"> 7 dager"}</TableCell>
                <TableCell className="text-right tabular-nums text-destructive">
                  {ageBuckets.older}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <p className="mt-2 text-xs text-muted-foreground">
            Rader eldre enn 30 dager slettes automatisk av cron.
          </p>
        </CardContent>
      </Card>

      {/* Email-domain breakdown */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Top 10 e-postdomener</CardTitle>
        </CardHeader>
        <CardContent>
          {topDomains.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ingen bekreftede svar ennå.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Domene</TableHead>
                  <TableHead className="text-right">Antall</TableHead>
                  <TableHead className="text-right">Andel</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topDomains.map(([domain, count]) => (
                  <TableRow key={domain}>
                    <TableCell className="font-mono text-xs">{domain}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {count}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {confirmed > 0
                        ? `${((count / confirmed) * 100).toFixed(1)} %`
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Aggregate cuts (mirror of public) */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Aggregert snapshot</CardTitle>
        </CardHeader>
        <CardContent>
          {aggregateRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Snapshot er tom. Trykk &quot;Frisk opp snapshot&quot; hvis det
              er bekreftede svar i basen.
            </p>
          ) : (
            <div className="space-y-4">
              {Array.from(byCut.entries()).map(([cut, rows]) => (
                <details key={cut} open={cut === "overall"} className="rounded border p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    {cut} <span className="text-muted-foreground">({rows.length} rader)</span>
                  </summary>
                  <Table className="mt-3">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Bucket</TableHead>
                        <TableHead className="text-right">Antall</TableHead>
                        <TableHead className="text-right">Andel</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={`${cut}:${r.bucket}`}>
                          <TableCell className="font-mono text-xs">
                            {r.bucket}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {r.confirmed_count}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {r.share_pct === null
                              ? "—"
                              : `${r.share_pct.toFixed(1)} %`}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </details>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
