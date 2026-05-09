import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SubmitButton } from "@/app/admin/_components/submit-button";
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
import { pastFFThreshold } from "@/lib/admin/legacy/fast-forward.js";
import {
  fastForwardAction,
  reprocessAction,
  runTier1Action,
  runTier2Action,
  stopDrainAction,
} from "./actions";

const BACKFILL_JOB = "backfill_nav_stillingsfeed";

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

type BackfillMeta = {
  next_cursor?: string | null;
  tail_cursor?: string | null;
  completed?: boolean;
  last_event_at?: string | null;
};

type LatestBackfill = {
  metadata: BackfillMeta | null;
};

type SnapshotHeadline = {
  computed_for: string;
  computed_at: string;
  ai_count_7d: number;
  ai_count_30d: number;
  ai_share_30d: number;
};

type CountRow = { count: number };

type EnrichQueueRow = { id: string };

function backfillStateLine(meta: BackfillMeta | null): string {
  if (!meta) return "Ikke startet ennå.";
  const last = meta.last_event_at
    ? ` Siste hendelse: ${fmtDateTime(meta.last_event_at)}.`
    : "";
  if (meta.completed) {
    const head = meta.tail_cursor
      ? `${String(meta.tail_cursor).slice(0, 8)}…`
      : "?";
    return `Innhentet til live head — daglig polling kl. 06:00 UTC. Head: ${head}.${last}`;
  }
  const cursor = meta.next_cursor
    ? `${String(meta.next_cursor).slice(0, 8)}…`
    : "start";
  if (!pastFFThreshold(meta.last_event_at)) {
    return `Hopper over pre-2024 (markør: ${cursor}).${last}`;
  }
  return `Innhenter (markør: ${cursor}).${last}`;
}

type OperationCardProps = {
  title: string;
  description: React.ReactNode;
  status?: React.ReactNode;
  buttonLabel: string;
  action: () => Promise<void>;
  disabled?: boolean;
};

function OperationCard({
  title,
  description,
  status,
  buttonLabel,
  action,
  disabled,
}: OperationCardProps) {
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="font-mono text-xs uppercase tracking-[0.18em]">
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1 text-sm text-muted-foreground">{status}</div>
        <form action={action}>
          <SubmitButton
            variant="outline"
            size="sm"
            pendingLabel="Kjører…"
            disabled={disabled}
          >
            {buttonLabel}
          </SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function JobMarketOverviewPage({ searchParams }: Props) {
  const params = await searchParams;

  // Filter activity table to NAV-relevant jobs. PostgREST `in.(...)`
  // accepts a comma-separated list; encode names defensively.
  const navJobsFilter = `name=in.(${NAV_JOB_NAMES.map(encodeURIComponent).join(",")})`;

  const [
    rows,
    latestBackfill,
    drainCoord,
    enrichQueue,
    headlineRows,
    postingsTotal,
    postingsAi7d,
    tier1QueueRows,
    tier2QueueRows,
  ] = await Promise.all([
    sbFetch<JobsTableRow[]>(
      `/jobs?${navJobsFilter}&select=id,name,trigger,status,started_at,finished_at,rows_processed,error,progress_pct,current_step&order=started_at.desc&limit=20`,
      { service: true },
    ).catch(() => [] as JobsTableRow[]),
    sbFetch<LatestBackfill[]>(
      `/jobs?name=eq.${BACKFILL_JOB}&order=started_at.desc&limit=1&select=metadata`,
      { service: true },
    ).catch(() => [] as LatestBackfill[]),
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
    ).catch(() => [] as CountRow[]),
    sbFetch<CountRow[] | { count: number }>(
      `/nav_postings?is_ai=is.true&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => [] as CountRow[]),
    sbFetch<CountRow[] | { count: number }>(
      `/nav_postings?tier1_completed_at=is.null&llm_retry_count=lt.3&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => [] as CountRow[]),
    sbFetch<CountRow[] | { count: number }>(
      `/nav_postings?is_ai=is.true&tier2_completed_at=is.null&llm_retry_count=lt.3&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => [] as CountRow[]),
  ]);

  const backfillMeta = latestBackfill[0]?.metadata ?? null;
  const drain = drainCoord[0] ?? null;
  const drainRunning = drain?.status === "running";
  const enrichQueueHas = enrichQueue.length > 0;
  const headline = headlineRows[0] ?? null;
  const runningCount = rows.filter((r) => r.status === "running").length;

  const totalPostings = Array.isArray(postingsTotal)
    ? (postingsTotal[0] as CountRow | undefined)?.count ?? postingsTotal.length
    : 0;
  const aiPostings7d = Array.isArray(postingsAi7d)
    ? (postingsAi7d[0] as CountRow | undefined)?.count ?? postingsAi7d.length
    : 0;
  const tier1Queue = Array.isArray(tier1QueueRows)
    ? (tier1QueueRows[0] as CountRow | undefined)?.count ?? tier1QueueRows.length
    : 0;
  const tier2Queue = Array.isArray(tier2QueueRows)
    ? (tier2QueueRows[0] as CountRow | undefined)?.count ?? tier2QueueRows.length
    : 0;

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
        description="NAV-pipelinen: fetch fra stillingsfeed, berikelse av aktive stillinger, klassifisering og snapshot-bygging. Cron driver normaltilstand; knappene under er escape hatches."
      />

      {drainRunning && drain ? (
        <DrainBanner row={drain} stopAction={stopDrainAction} />
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Stillinger totalt"
          value={totalPostings}
          hint="Alle NAV-rader (aktive + utløpt)"
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
          hint={`Treff totalt (alltid): ${aiPostings7d}`}
        />
        <StatCard
          label="Berikelseskø"
          value={enrichQueueHas ? "Venter" : "Tom"}
          hint="Cron drainer hvert 15. min"
        />
      </div>

      <h2 className="mt-8 mb-3 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-muted-foreground">
        Operasjoner
      </h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:auto-rows-fr">
        <OperationCard
          title="Backfill"
          description="Drainer hele NAV-feeden i én kjøring: hopper over alt før 2024-01-01 (NAV migrasjons-burst), så full innhenting til live head. Tar ~3 timer. Cron etter 06:00 UTC dekker normaltilstand."
          status={backfillStateLine(backfillMeta)}
          buttonLabel={drainRunning ? "Kjører…" : "Backfill"}
          action={fastForwardAction}
          disabled={drainRunning}
        />
        <OperationCard
          title="Kjør keyword-mapping"
          description="Re-tagger hele nav_postings-tabellen mot dagens nøkkelord-regler. Kjør etter en stor endring i Nøkkelord eller Kategorier. Idempotent."
          status="Manuell trigger — ingen cron."
          buttonLabel="Kjør keyword-mapping"
          action={reprocessAction}
        />
        <OperationCard
          title="Kjør Tier 1 (deteksjon)"
          description="LLM-burst som markerer AI-relevans og henter ut AI-fraser fra stillinger der tier1_completed_at er null. Cron drainer kontinuerlig (08, 23, 38, 53); knappen er en manuell drainer ved store re-deploys eller kø-pukler."
          status={`${tier1Queue.toLocaleString("nb-NO")} stillinger ventende på Tier 1.`}
          buttonLabel="Kjør Tier 1"
          action={runTier1Action}
          disabled={tier1Queue === 0}
        />
        <OperationCard
          title="Kjør Tier 2 (kategorisering)"
          description="LLM-burst som plasserer AI-stillinger i taksonomi-kategorier og scorer konfidens. Cron drainer kontinuerlig (11, 26, 41, 56); knappen er en manuell drainer."
          status={`${tier2Queue.toLocaleString("nb-NO")} AI-stillinger ventende på Tier 2.`}
          buttonLabel="Kjør Tier 2"
          action={runTier2Action}
          disabled={tier2Queue === 0}
        />
      </div>

      <Card className="mt-8 gap-0 p-0">
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
