import Link from "next/link";
import { ArrowRight } from "lucide-react";

import {
  Card,
  CardContent,
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

type SnapshotHeadline = {
  computed_for: string;
  computed_at: string;
  ai_count_7d: number;
  ai_count_30d: number;
  ai_share_30d: number;
};

type KeywordCount = { count: number };

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminOverviewPage({ searchParams }: Props) {
  const params = await searchParams;
  const claims = await getStaffClaims();
  const role = claims?.user_metadata?.role ?? "ukjent";
  const name = claims?.user_metadata?.full_name ?? claims?.email ?? "ukjent";

  const [headlines, recentJobs, keywordRows] = await Promise.all([
    sbFetch<SnapshotHeadline[]>(
      "/snapshot_headline?order=computed_for.desc&limit=1&select=computed_for,computed_at,ai_count_7d,ai_count_30d,ai_share_30d",
      { service: true },
    ).catch(() => [] as SnapshotHeadline[]),
    sbFetch<JobsTableRow[]>(
      "/jobs?select=id,name,status,trigger,started_at,finished_at,rows_processed,error,progress_pct,current_step&order=started_at.desc&limit=10",
      { service: true },
    ).catch(() => [] as JobsTableRow[]),
    sbFetch<KeywordCount[] | { count: number }>(
      "/keywords?status=eq.canonical&select=count",
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => [] as KeywordCount[]),
  ]);

  const headline = headlines[0] ?? null;
  const activeKeywords = Array.isArray(keywordRows)
    ? (keywordRows[0] as KeywordCount | undefined)?.count ?? keywordRows.length
    : 0;
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard
          label="AI-stillinger 7d"
          value={headline?.ai_count_7d ?? "—"}
          hint={
            headline
              ? `Snapshot for ${headline.computed_for}`
              : "Ingen snapshots ennå"
          }
        />
        <StatCard
          label="AI-stillinger 30d"
          value={headline?.ai_count_30d ?? "—"}
          hint={
            headline
              ? `Andel: ${headline.ai_share_30d != null ? (headline.ai_share_30d * 100).toFixed(2) + "%" : "—"}`
              : "Kjør snapshot-refresh på Prosesser"
          }
        />
        <StatCard
          label="Aktive nøkkelord"
          value={activeKeywords}
          hint="Inkluderingslisten — endres på Nøkkelord"
        />
      </div>

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
