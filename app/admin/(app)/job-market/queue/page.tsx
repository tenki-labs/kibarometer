import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
import { fmtDateTime } from "@/lib/admin/flash";
import { sbFetch } from "@/lib/admin/sb";

import {
  runEnrichAction,
  runTier1Action,
  runTier2Action,
} from "./actions";
import {
  fastForwardAction,
  refreshSnapshotsAction,
  reprocessAction,
} from "../actions";

export const dynamic = "force-dynamic";

const PEEK_LIMIT = 25;

type QueueRow = {
  id: string;
  title: string | null;
  employer_name: string | null;
  source_url: string | null;
  posted_at: string | null;
  detail_fetched_at: string | null;
  tier1_completed_at: string | null;
  tier2_completed_at: string | null;
};

type CountRow = { count: number };

type CandidateCountRow = { count: number };

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function fetchCount(filter: string): Promise<number> {
  const rows = await sbFetch<CountRow[] | { count: number }>(
    `/nav_postings?select=count&${filter}`,
    { service: true, headers: { Prefer: "count=exact" } },
  ).catch(() => [] as CountRow[]);
  return Array.isArray(rows)
    ? (rows[0] as CountRow | undefined)?.count ?? 0
    : 0;
}

async function fetchPeek(filter: string): Promise<QueueRow[]> {
  return sbFetch<QueueRow[]>(
    `/nav_postings?select=id,title,employer_name,source_url,posted_at,detail_fetched_at,tier1_completed_at,tier2_completed_at` +
      `&order=posted_at.desc.nullslast&limit=${PEEK_LIMIT}&${filter}`,
    { service: true },
  ).catch(() => [] as QueueRow[]);
}

export default async function NavQueuePage({ searchParams }: Props) {
  const sp = await searchParams;

  // Pipeline stages — three filters that mirror what the cron orchestrators
  // actually process. Without is_ai + retry-cap predicates, rows that flipped
  // is_ai=true → false after a keyword retag (or hit the retry ceiling) would
  // sit in the queue forever even though no processor would touch them, so
  // the header's "trender mot null" promise would be a lie.
  // Berikelse: nav_postings.detail_fetched_at IS NULL AND status=ACTIVE — enrich-nav cron.
  // Klassifisering T1: mirrors lib/admin/llm-discover.ts:87-89.
  // Klassifisering T2: mirrors lib/admin/llm-classify.ts:116-117 (also matches Claude drain).
  const ENRICH_FILTER = "status=eq.ACTIVE&detail_fetched_at=is.null";
  const T1_FILTER = "tier1_completed_at=is.null&detail_fetched_at=not.is.null&ingest_mode=eq.live&is_ai=eq.true&llm_retry_count=lt.3";
  const T2_FILTER = "is_ai=eq.true&tier2_completed_at=is.null&llm_retry_count=lt.3";

  const [
    enrichCount,
    t1Count,
    t2Count,
    candidatesCount,
    enrichRows,
    t1Rows,
    t2Rows,
  ] = await Promise.all([
    fetchCount(ENRICH_FILTER),
    fetchCount(T1_FILTER),
    fetchCount(T2_FILTER),
    sbFetch<CandidateCountRow[] | { count: number }>(
      `/keyword_candidates?select=count&status=eq.pending`,
      { service: true, headers: { Prefer: "count=exact" } },
    )
      .then((rows) =>
        Array.isArray(rows)
          ? (rows[0] as CandidateCountRow | undefined)?.count ?? 0
          : 0,
      )
      .catch(() => 0),
    fetchPeek(ENRICH_FILTER),
    fetchPeek(T1_FILTER),
    fetchPeek(T2_FILTER),
  ]);

  return (
    <>
      <Flash searchParams={sp} />
      <PageHeader
        eyebrow="Jobbmarked"
        title="Kø"
        description="Pågående pipeline-trinn for NAV. Cron drainer normaltilstand — disse tellingene skal trende mot null mellom kjøringer. Operasjoner-kortet under er escape hatches."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Berikelse"
          value={enrichCount.toLocaleString("nb-NO")}
          hint="Cron hvert 15. min"
        />
        <StatCard
          label="Klassifisering T1"
          value={t1Count.toLocaleString("nb-NO")}
          hint="Cron hvert 15. min"
        />
        <StatCard
          label="Klassifisering T2"
          value={t2Count.toLocaleString("nb-NO")}
          hint="Cron hvert 15. min"
        />
        <StatCard
          label="Kandidater"
          value={candidatesCount.toLocaleString("nb-NO")}
          hint={
            <Link
              href="/admin/keywords/candidates"
              className="inline-flex items-center gap-1 text-foreground hover:opacity-80"
            >
              Gå til kandidater
              <ArrowRight className="size-3.5" />
            </Link>
          }
        />
      </div>

      <Card className="mt-6 gap-3">
        <CardHeader>
          <CardTitle className="font-mono text-[0.7rem] uppercase tracking-[0.14em]">
            Operasjoner
          </CardTitle>
          <CardDescription>
            De fem essensielle knappene for NAV-pipelinen. Cron dekker
            normaltilstand — bruk når du har en backfill-pukkel eller vil
            verifisere et taksonomi-skifte. Backfill kjører via en
            koordinator-jobb (~3 t) og kan stoppes fra dashboardet.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <form action={reprocessAction}>
            <SubmitButton variant="outline" size="sm" pendingLabel="Starter…">
              Keyword-mapping
            </SubmitButton>
          </form>
          <form action={fastForwardAction}>
            <SubmitButton variant="outline" size="sm" pendingLabel="Starter…">
              Backfill
            </SubmitButton>
          </form>
          <form action={runEnrichAction}>
            <SubmitButton
              variant="outline"
              size="sm"
              pendingLabel="Kjører…"
              disabled={enrichCount === 0}
            >
              Tøm enrich-kø ({enrichCount.toLocaleString("nb-NO")})
            </SubmitButton>
          </form>
          <form action={runTier1Action}>
            <SubmitButton
              variant="outline"
              size="sm"
              pendingLabel="Starter…"
              disabled={t1Count === 0}
            >
              Kjør Tier 1 ({t1Count.toLocaleString("nb-NO")})
            </SubmitButton>
          </form>
          <form action={runTier2Action}>
            <SubmitButton
              variant="outline"
              size="sm"
              pendingLabel="Starter…"
              disabled={t2Count === 0}
            >
              Kjør Tier 2 ({t2Count.toLocaleString("nb-NO")})
            </SubmitButton>
          </form>
          <form action={refreshSnapshotsAction}>
            <SubmitButton variant="outline" size="sm" pendingLabel="Regner…">
              Refresh snapshots
            </SubmitButton>
          </form>
        </CardContent>
      </Card>

      <QueueSampleCard
        title="Berikelse · sample"
        rows={enrichRows}
        emptyLabel="Berikelseskøen er tom — alle aktive stillinger har detalj-payload."
      />
      <QueueSampleCard
        title="Tier 1 · sample"
        rows={t1Rows}
        emptyLabel="Ingen rader venter på Tier 1-klassifisering."
      />
      <QueueSampleCard
        title="Tier 2 · sample"
        rows={t2Rows}
        emptyLabel="Ingen rader venter på Tier 2-klassifisering."
      />
    </>
  );
}

function QueueSampleCard({
  title,
  rows,
  emptyLabel,
}: {
  title: string;
  rows: QueueRow[];
  emptyLabel: string;
}) {
  return (
    <Card className="mt-6 gap-0 p-0">
      <CardHeader className="px-6 py-4">
        <CardTitle className="font-mono text-[0.7rem] uppercase tracking-[0.14em]">
          {title} (siste {PEEK_LIMIT})
        </CardTitle>
      </CardHeader>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tittel</TableHead>
              <TableHead>Arbeidsgiver</TableHead>
              <TableHead>Postet</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={3}
                  className="py-10 text-center text-muted-foreground"
                >
                  {emptyLabel}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="max-w-md">
                    {p.source_url ? (
                      <a
                        href={p.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 truncate text-sm hover:opacity-80"
                      >
                        <span className="truncate">
                          {p.title ?? "(uten tittel)"}
                        </span>
                        <ExternalLink className="size-3 shrink-0" />
                      </a>
                    ) : (
                      <span className="truncate text-sm">
                        {p.title ?? "(uten tittel)"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {p.employer_name ?? "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {p.posted_at ? fmtDateTime(p.posted_at) : "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {rows.length > 0 && (
        <div className="flex justify-end border-t px-6 py-3">
          <Badge
            variant="outline"
            className="font-mono text-[0.65rem] text-muted-foreground"
          >
            Avgrenset til {PEEK_LIMIT} rader
          </Badge>
        </div>
      )}
    </Card>
  );
}
