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
import { Flash } from "@/app/admin/_components/flash";
import { PageHeader } from "@/app/admin/_components/page-header";
import { StatCard } from "@/app/admin/_components/stat-card";
import { StatusBadge } from "@/app/admin/_components/status-badge";
import { sbFetch } from "@/lib/admin/sb";
import { fmtDateTime } from "@/lib/admin/flash";
import { getStaffClaims } from "@/lib/admin/auth";

type SnapshotHeadline = {
  computed_for: string;
  computed_at: string;
  ai_count_7d: number;
  ai_count_30d: number;
  ai_share_30d: number;
};

type RecentJob = {
  id: string;
  name: string;
  status: string;
  trigger: string;
  started_at: string;
  finished_at: string | null;
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
    sbFetch<RecentJob[]>(
      "/jobs?select=id,name,status,trigger,started_at,finished_at&order=started_at.desc&limit=5",
      { service: true },
    ).catch(() => [] as RecentJob[]),
    sbFetch<KeywordCount[] | { count: number }>(
      "/keywords?is_active=eq.true&select=count",
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => [] as KeywordCount[]),
  ]);

  const headline = headlines[0] ?? null;
  const activeKeywords = Array.isArray(keywordRows)
    ? (keywordRows[0] as KeywordCount | undefined)?.count ?? keywordRows.length
    : 0;

  return (
    <>
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
              : "Kjør snapshot-refresh på Jobber"
          }
        />
        <StatCard
          label="Aktive nøkkelord"
          value={activeKeywords}
          hint="Inkluderingslisten — endres på Nøkkelord"
        />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="font-mono text-[0.7rem] uppercase tracking-[0.14em]">
            Siste jobber
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentJobs.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Ingen jobber ennå.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {recentJobs.map((job) => (
                <li
                  key={job.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <StatusBadge status={job.status} />
                    <code className="truncate font-mono text-xs">
                      {job.name}
                    </code>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{fmtDateTime(job.started_at)}</span>
                    <span className="font-mono uppercase tracking-wider">
                      {job.trigger}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
        <CardFooter className="border-t pt-4">
          <Link
            href="/admin/jobs"
            className="inline-flex items-center gap-1 text-xs font-medium text-foreground transition-opacity hover:opacity-80"
          >
            Se alle jobber
            <ArrowRight className="size-3.5" />
          </Link>
        </CardFooter>
      </Card>
    </>
  );
}
