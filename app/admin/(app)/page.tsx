import Link from "next/link";
import { ArrowRight, BarChart3 } from "lucide-react";

import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AutoRefresh } from "@/app/admin/_components/auto-refresh";
import { Flash } from "@/app/admin/_components/flash";
import { JobsTable, type JobsTableRow } from "@/app/admin/_components/jobs-table";
import { PageHeader } from "@/app/admin/_components/page-header";
import { StatCard } from "@/app/admin/_components/stat-card";
import { sbFetch } from "@/lib/admin/sb";
import { getStaffClaims } from "@/lib/admin/auth";
import { getStats, umamiConfigured } from "@/lib/admin/umami";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminOverviewPage({ searchParams }: Props) {
  const params = await searchParams;
  const claims = await getStaffClaims();
  const role = claims?.user_metadata?.role ?? "ukjent";
  const name = claims?.user_metadata?.full_name ?? claims?.email ?? "ukjent";

  const umami = umamiConfigured();
  const [recentJobs, stats] = await Promise.all([
    sbFetch<JobsTableRow[]>(
      "/jobs?select=id,name,status,trigger,started_at,finished_at,rows_processed,error,progress_pct,current_step&order=started_at.desc&limit=10",
      { service: true },
    ).catch(() => [] as JobsTableRow[]),
    umami ? getStats(umami, "7d").catch(() => null) : Promise.resolve(null),
  ]);

  const runningCount = recentJobs.filter((r) => r.status === "running").length;

  return (
    <>
      <AutoRefresh enabled={runningCount > 0} intervalMs={5000} />
      <Flash searchParams={params} />
      <PageHeader
        eyebrow="Drift"
        title="Oversikt"
        description={
          <>
            Velkommen, <span className="text-foreground">{name}</span>. Rolle:{" "}
            <Badge variant="outline" className="font-mono text-[0.65rem]">
              {role}
            </Badge>
          </>
        }
      />

      {umami ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Sidevisninger 7d"
              value={stats ? stats.pageviews.value.toLocaleString("nb-NO") : "—"}
              hint={stats ? diffHint(stats.pageviews.value, stats.pageviews.prev) : "—"}
            />
            <StatCard
              label="Unike besøkende 7d"
              value={stats ? stats.visitors.value.toLocaleString("nb-NO") : "—"}
              hint={stats ? diffHint(stats.visitors.value, stats.visitors.prev) : "—"}
            />
            <StatCard
              label="Økter 7d"
              value={stats ? stats.visits.value.toLocaleString("nb-NO") : "—"}
              hint={stats ? diffHint(stats.visits.value, stats.visits.prev) : "—"}
            />
            <StatCard
              label="Snittid (s)"
              value={
                stats && stats.visits.value > 0
                  ? Math.round(stats.totaltime.value / stats.visits.value).toString()
                  : "—"
              }
              hint="per økt"
            />
          </div>
          <div className="mt-3 flex justify-end">
            <Link
              href="/admin/analytics"
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <BarChart3 className="size-3.5" />
              Se full analytics
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em]">
              <BarChart3 className="size-3.5" />
              Umami er ikke ferdig satt opp
            </CardTitle>
            <CardDescription>
              Sett{" "}
              <code className="font-mono">UMAMI_USERNAME</code>,{" "}
              <code className="font-mono">UMAMI_PASSWORD</code> og{" "}
              <code className="font-mono">UMAMI_WEBSITE_ID</code> i env-filen.
              Full runbook på{" "}
              <Link href="/admin/analytics" className="underline">
                /admin/analytics
              </Link>
              .
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <Card className="mt-6 gap-0 p-0">
        <CardHeader className="px-6 py-4">
          <div className="flex items-center justify-between">
            <CardTitle className="font-mono text-[0.7rem] uppercase tracking-[0.14em]">
              Pågående og siste prosesser
            </CardTitle>
            <span className="text-xs text-muted-foreground">
              {runningCount > 0 ? `${runningCount} kjører nå` : "Klar"}
            </span>
          </div>
        </CardHeader>
        <JobsTable rows={recentJobs} mode="compact" />
        <CardFooter className="border-t px-6 py-4">
          <Link
            href="/admin/processes"
            className="inline-flex items-center gap-1 text-xs font-medium text-foreground transition-opacity hover:opacity-80"
          >
            Se alle prosesser
            <ArrowRight className="size-3.5" />
          </Link>
        </CardFooter>
      </Card>
    </>
  );
}

function diffHint(curr?: number, prev?: number): string {
  if (curr == null || prev == null) return "—";
  if (prev === 0) return curr > 0 ? "ny periode" : "ingen forrige";
  const diff = curr - prev;
  const pct = (diff / prev) * 100;
  const sign = diff >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(0)}% mot forrige`;
}
