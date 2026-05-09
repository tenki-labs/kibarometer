import Link from "next/link";
import { ArrowRight, FileText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
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
import { AutoRefresh } from "@/app/admin/_components/auto-refresh";
import { Flash } from "@/app/admin/_components/flash";
import {
  DrainBanner,
  type DrainCoordinatorRow,
} from "@/app/admin/_components/drain-banner";
import { JobsTable, type JobsTableRow } from "@/app/admin/_components/jobs-table";
import { PageHeader } from "@/app/admin/_components/page-header";
import { StatCard } from "@/app/admin/_components/stat-card";
import { sbFetch } from "@/lib/admin/sb";
import { fmtDateTime } from "@/lib/admin/flash";
import { stopDrainAction } from "./actions";

// All NAV-name prefixes the activity table should surface. The
// jobDomain() helper would also work but PostgREST doesn't speak it,
// so we list the literal names here.
const NAV_JOB_NAMES = [
  "fetch_nav_stillingsfeed",
  "backfill_nav_stillingsfeed",
  "backfill_drain",
  "enrich_nav",
  "reprocess_nav_postings",
  "refresh_snapshots",
  "refresh_keyword_candidates",
];

type SnapshotHeadline = {
  computed_for: string;
  computed_at: string;
  ai_count_7d: number;
  ai_count_30d: number;
  ai_share_30d: number;
};

type CountRow = { count: number };

type EnrichQueueRow = { id: string };

type RecentPosting = {
  id: string;
  title: string | null;
  employer_name: string | null;
  status: string | null;
  source_url: string | null;
  posted_at: string | null;
  is_ai: boolean;
  tier1_completed_at: string | null;
  tier2_completed_at: string | null;
};

function unwrapCount(rows: CountRow[] | { count: number } | null): number {
  if (!rows) return 0;
  if (Array.isArray(rows)) return rows[0]?.count ?? 0;
  return rows.count ?? 0;
}

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function JobMarketOverviewPage({ searchParams }: Props) {
  const params = await searchParams;

  const navJobsFilter = `name=in.(${NAV_JOB_NAMES.map(encodeURIComponent).join(",")})`;

  const [
    rows,
    drainCoord,
    enrichQueue,
    headlineRows,
    postingsTotal,
    postingsAi7d,
    recentPostings,
  ] = await Promise.all([
    sbFetch<JobsTableRow[]>(
      `/jobs?${navJobsFilter}&select=id,name,trigger,status,started_at,finished_at,rows_processed,error,progress_pct,current_step&order=started_at.desc&limit=20`,
      { service: true },
    ).catch(() => [] as JobsTableRow[]),
    sbFetch<DrainCoordinatorRow[]>(
      `/jobs?name=eq.backfill_drain&order=started_at.desc&limit=1` +
        `&select=id,status,started_at,finished_at,last_heartbeat,current_step,progress_pct,metadata`,
      { service: true },
    ).catch(() => [] as DrainCoordinatorRow[]),
    sbFetch<EnrichQueueRow[]>(
      `/nav_postings?status=eq.ACTIVE&detail_fetched_at=is.null&select=id&limit=1`,
      { service: true },
    ).catch(() => [] as EnrichQueueRow[]),
    sbFetch<SnapshotHeadline[]>(
      `/snapshot_headline?order=computed_for.desc&limit=1&select=computed_for,computed_at,ai_count_7d,ai_count_30d,ai_share_30d`,
      { service: true },
    ).catch(() => [] as SnapshotHeadline[]),
    sbFetch<CountRow[] | { count: number }>(
      `/nav_postings?select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => null),
    sbFetch<CountRow[] | { count: number }>(
      `/nav_postings?is_ai=is.true&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => null),
    sbFetch<RecentPosting[]>(
      `/nav_postings?order=posted_at.desc.nullslast&limit=20` +
        `&select=id,title,employer_name,status,source_url,posted_at,is_ai,tier1_completed_at,tier2_completed_at`,
      { service: true },
    ).catch(() => [] as RecentPosting[]),
  ]);

  const drain = drainCoord[0] ?? null;
  const drainRunning = drain?.status === "running";
  const enrichQueueHas = enrichQueue.length > 0;
  const headline = headlineRows[0] ?? null;
  const runningCount = rows.filter((r) => r.status === "running").length;

  const totalPostings = unwrapCount(postingsTotal);
  const aiPostingsAll = unwrapCount(postingsAi7d);

  return (
    <>
      <AutoRefresh
        enabled={drainRunning || runningCount > 0}
        intervalMs={3000}
      />
      <Flash searchParams={params} />
      <PageHeader
        eyebrow="Jobbmarked"
        title="Oversikt"
        description="NAV-pipelinen: fetch fra stillingsfeed, berikelse av aktive stillinger, klassifisering og snapshot-bygging. Operasjoner ligger på Kø."
        action={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/admin/job-market/postings">Stillinger</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/admin/job-market/categories">Kategorier</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/admin/job-market/queue">Kø</Link>
            </Button>
          </div>
        }
      />

      {drainRunning && drain ? (
        <DrainBanner row={drain} stopAction={stopDrainAction} />
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Stillinger totalt"
          value={totalPostings.toLocaleString("nb-NO")}
          hint={`${aiPostingsAll.toLocaleString("nb-NO")} AI-relaterte (alltid)`}
        />
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
          label="AI-andel 30d"
          value={
            headline?.ai_share_30d != null
              ? `${(headline.ai_share_30d * 100).toFixed(2)}%`
              : "—"
          }
          hint={
            headline?.ai_count_30d != null
              ? `${headline.ai_count_30d.toLocaleString("nb-NO")} stillinger 30d`
              : "Snapshot ikke kjørt ennå"
          }
        />
        <StatCard
          label="Berikelseskø"
          value={enrichQueueHas ? "Venter" : "Tom"}
          hint="Cron drainer hvert 15. min"
        />
      </div>

      <Card className="mt-6 gap-0 p-0">
        <CardHeader className="px-6 py-4">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.14em]">
              <FileText className="size-4" />
              Siste 20 stillinger
            </CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/admin/job-market/postings">
                Se alle
                <ArrowRight />
              </Link>
            </Button>
          </div>
        </CardHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tittel</TableHead>
                <TableHead>Arbeidsgiver</TableHead>
                <TableHead>Postet</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Pipeline</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentPostings.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-12 text-center text-muted-foreground"
                  >
                    Ingen stillinger ennå. Kjør backfill fra Kø.
                  </TableCell>
                </TableRow>
              ) : (
                recentPostings.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="max-w-md">
                      <span className="font-medium">
                        {p.title ?? "(uten tittel)"}
                      </span>
                      {p.source_url ? (
                        <div className="mt-0.5 truncate text-[0.7rem] text-muted-foreground">
                          {p.source_url}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.employer_name ?? "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {p.posted_at ? fmtDateTime(p.posted_at) : "—"}
                    </TableCell>
                    <TableCell>
                      {p.status ? (
                        <Badge
                          variant="outline"
                          className="font-mono text-[0.65rem]"
                        >
                          {p.status}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1 text-[0.65rem]">
                        {p.is_ai ? (
                          <Badge variant="outline" className="font-mono">
                            AI
                          </Badge>
                        ) : null}
                        {p.tier1_completed_at ? (
                          <Badge variant="outline" className="font-mono">
                            T1
                          </Badge>
                        ) : null}
                        {p.tier2_completed_at ? (
                          <Badge variant="outline" className="font-mono">
                            T2
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Card className="mt-6 gap-0 p-0">
        <CardHeader className="px-6 py-4">
          <div className="flex items-center justify-between">
            <CardTitle className="font-mono text-[0.7rem] uppercase tracking-[0.14em]">
              Siste NAV-prosesser
            </CardTitle>
            <span className="text-xs text-muted-foreground">
              {rows.length} {rows.length === 1 ? "rad" : "rader"}
            </span>
          </div>
        </CardHeader>
        <JobsTable rows={rows} mode="full" emptyLabel="Ingen NAV-prosesser ennå." />
      </Card>
    </>
  );
}
