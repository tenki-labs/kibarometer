import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Flash } from "@/app/admin/_components/flash";
import { PageHeader } from "@/app/admin/_components/page-header";
import { SubmitButton } from "@/app/admin/_components/submit-button";
import { fmtDateTime } from "@/lib/admin/flash";
import { sbFetch } from "@/lib/admin/sb";

import {
  runEnrichAction,
  runTier1Action,
  runTier2Action,
} from "./actions";

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

function single(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? "";
  return v ?? "";
}

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
  const tab = single(sp.tab) || "enrich";

  // Pipeline stages — three filters that mirror the cron orchestrators.
  // Berikelse (enrichment): nav_postings.detail_fetched_at IS NULL AND status=ACTIVE.
  //   Drained by enrich-nav cron every 15 min.
  // Klassifisering T1: tier1_completed_at IS NULL AND detail_fetched_at IS NOT NULL.
  //   The cron runs every 15 min on detail-enriched rows.
  // Klassifisering T2: tier2_completed_at IS NULL AND tier1_completed_at IS NOT NULL.
  //   Tier 2 only runs after Tier 1 succeeded.
  const ENRICH_FILTER =
    "status=eq.ACTIVE&detail_fetched_at=is.null";
  const T1_FILTER =
    "tier1_completed_at=is.null&detail_fetched_at=not.is.null";
  const T2_FILTER =
    "tier2_completed_at=is.null&tier1_completed_at=not.is.null";

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
        description="Pågående pipeline-trinn for NAV. Cron drainer normaltilstand — disse tellingene skal trende mot null mellom kjøringer."
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <StageCard label="Berikelse" count={enrichCount} hint="Cron hvert 15. min" />
        <StageCard label="Klassifisering T1" count={t1Count} hint="Cron hvert 15. min" />
        <StageCard label="Klassifisering T2" count={t2Count} hint="Cron hvert 15. min" />
        <Card className="gap-2">
          <CardContent className="pt-4">
            <div className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-muted-foreground">
              Kandidater
            </div>
            <div className="mt-1 text-2xl font-medium tabular-nums">
              {candidatesCount.toLocaleString("nb-NO")}
            </div>
            <Link
              href="/admin/keywords/candidates"
              className="mt-1 inline-flex items-center gap-1 text-xs text-foreground hover:opacity-80"
            >
              Gå til kandidater
              <ArrowRight className="size-3.5" />
            </Link>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue={tab}>
        <TabsList>
          <TabsTrigger value="enrich">
            Berikelse · {enrichCount.toLocaleString("nb-NO")}
          </TabsTrigger>
          <TabsTrigger value="tier1">
            Tier 1 · {t1Count.toLocaleString("nb-NO")}
          </TabsTrigger>
          <TabsTrigger value="tier2">
            Tier 2 · {t2Count.toLocaleString("nb-NO")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="enrich">
          <DrainBar
            label="Tøm enrich-kø"
            description="Drainer én batch (~60s budget) av berikelses-køen — samme orchestrator som cron kjører hvert 15. min."
            disabled={enrichCount === 0}
            action={runEnrichAction}
          />
          <QueueTable
            rows={enrichRows}
            emptyLabel="Berikelseskøen er tom — alle aktive stillinger har detalj-payload."
          />
        </TabsContent>
        <TabsContent value="tier1">
          <DrainBar
            label="Kjør Tier 1"
            description="Drainer én batch av Tier 1 LLM-køen. Samme orchestrator som cron + Hub-knappen."
            disabled={t1Count === 0}
            action={runTier1Action}
          />
          <QueueTable
            rows={t1Rows}
            emptyLabel="Ingen rader venter på Tier 1-klassifisering."
          />
        </TabsContent>
        <TabsContent value="tier2">
          <DrainBar
            label="Kjør Tier 2"
            description="Drainer én batch av Tier 2 LLM-køen. Samme orchestrator som cron + Hub-knappen."
            disabled={t2Count === 0}
            action={runTier2Action}
          />
          <QueueTable
            rows={t2Rows}
            emptyLabel="Ingen rader venter på Tier 2-klassifisering."
          />
        </TabsContent>
      </Tabs>
    </>
  );
}

function DrainBar({
  label,
  description,
  disabled,
  action,
}: {
  label: string;
  description: string;
  disabled: boolean;
  action: () => Promise<void>;
}) {
  return (
    <Card className="mt-4 gap-3">
      <CardContent className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex-1 text-sm text-muted-foreground">{description}</p>
        <form action={action}>
          <SubmitButton
            variant="outline"
            size="sm"
            pendingLabel="Starter…"
            disabled={disabled}
          >
            {label}
          </SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}

function StageCard({
  label,
  count,
  hint,
}: {
  label: string;
  count: number;
  hint: string;
}) {
  return (
    <Card className="gap-2">
      <CardContent className="pt-4">
        <div className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </div>
        <div className="mt-1 text-2xl font-medium tabular-nums">
          {count.toLocaleString("nb-NO")}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}

function QueueTable({
  rows,
  emptyLabel,
}: {
  rows: QueueRow[];
  emptyLabel: string;
}) {
  return (
    <Card className="mt-4 gap-0 p-0">
      <CardHeader className="px-6 py-4">
        <CardTitle className="font-mono text-[0.7rem] uppercase tracking-[0.14em]">
          Sample (siste {PEEK_LIMIT})
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
