import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Briefcase,
  Building2,
  KeyRound,
  ListChecks,
  Newspaper,
  Sparkles,
  StopCircle,
  Wifi,
  WifiOff,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import { AutoRefresh } from "@/app/admin/_components/auto-refresh";
import { fmtDateTime } from "@/lib/admin/flash";
import { mlxConfigured, readMlxHealth } from "@/lib/admin/mlx";
import { sbFetch } from "@/lib/admin/sb";
import { anthropicConfigured } from "@/lib/admin/anthropic";
import { NAV_CLAUDE_JOB_NAME } from "@/lib/admin/llm-classify-claude";
import { BRREG_CLAUDE_JOB_NAME } from "@/lib/admin/llm-brreg-tier2-claude";
import {
  pingAction,
  startClaudeDrainAction,
  stopClaudeDrainAction,
} from "./actions";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type TunnelState = "green" | "yellow" | "red" | "unknown";

// Failed-status enum from migration 0014. Enumerated rather than `like '%_failed'`
// because PostgREST's like operator treats `_` as a wildcard which would also
// match e.g. `tier1_ok`. Auth-failed is split out separately for the banner.
const FAILED_STATUSES = [
  "tier1_parse_failed",
  "tier1_failed",
  "tier1_auth_failed",
  "tier2_parse_failed",
  "tier2_failed",
  "tier2_auth_failed",
] as const;
const AUTH_FAILED_STATUSES = ["tier1_auth_failed", "tier2_auth_failed"] as const;

// All cron jobs that drain an LLM queue across the three domains. Aggregating
// `metadata.processed` / fail-counters from these gives the cross-domain
// "Analysert 24t" + "Feilrate 24t" numbers in the Generelt section.
const LLM_JOB_NAMES = [
  "llm-discover",
  "llm-classify",
  "media-llm-tier1",
  "media-llm-tier2",
  "brreg-llm-tier1",
  "brreg-llm-tier2",
] as const;

const STATUS_LABEL: Record<string, string> = {
  tier1_ok: "Tier 1 OK",
  tier1_parse_failed: "Tier 1 parse-feil",
  tier1_failed: "Tier 1 HTTP-feil",
  tier1_auth_failed: "Tier 1 auth-feil",
  tier2_ok: "Tier 2 OK",
  tier2_parse_failed: "Tier 2 parse-feil",
  tier2_failed: "Tier 2 HTTP-feil",
  tier2_auth_failed: "Tier 2 auth-feil",
  skipped: "Hoppet over",
};

type CountRow = { count: number };

type FailureRow = {
  id: string;
  title: string | null;
  llm_status: string | null;
  llm_retry_count: number | null;
  posted_at: string | null;
};

type LlmJobRow = {
  name: string;
  status: string;
  started_at: string;
  metadata: Record<string, unknown> | null;
};

type ClaudeDrainJobRow = {
  id: string;
  name: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  current_step: string | null;
  progress_pct: number | string | null;
  metadata: Record<string, unknown> | null;
  rows_processed: number | null;
  error: string | null;
};

const CLAUDE_DRAIN_JOB_NAMES = [
  NAV_CLAUDE_JOB_NAME,
  BRREG_CLAUDE_JOB_NAME,
] as const;

function pickLatestDrainJob(
  rows: ClaudeDrainJobRow[],
  jobName: string,
): ClaudeDrainJobRow | null {
  for (const r of rows) {
    if (r.name === jobName) return r;
  }
  return null;
}

function isLiveDrain(job: ClaudeDrainJobRow | null): boolean {
  return !!job && job.status === "running" && job.finished_at == null;
}

function isRecentlyFinished(job: ClaudeDrainJobRow | null): boolean {
  if (!job || !job.finished_at) return false;
  const ageMs = Date.now() - new Date(job.finished_at).getTime();
  return ageMs < 5 * 60 * 1000;
}

function progressPctNumber(v: number | string | null): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function classifyTunnel(lastSuccessAt: string | null): TunnelState {
  if (!lastSuccessAt) return "unknown";
  const ageMs = Date.now() - new Date(lastSuccessAt).getTime();
  if (ageMs < 2 * 60 * 1000) return "green";
  if (ageMs < 30 * 60 * 1000) return "yellow";
  return "red";
}

function tunnelBadge(state: TunnelState) {
  const map: Record<TunnelState, { label: string; className: string }> = {
    green: {
      label: "Tilgjengelig",
      className:
        "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
    },
    yellow: {
      label: "Stille",
      className:
        "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
    },
    red: {
      label: "Utilgjengelig",
      className:
        "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30",
    },
    unknown: {
      label: "Ikke kontaktet",
      className: "bg-muted text-muted-foreground border-muted-foreground/20",
    },
  };
  const { label, className } = map[state];
  return (
    <Badge variant="outline" className={className}>
      {label}
    </Badge>
  );
}

function statusBadge(status: string) {
  const isAuth = status.endsWith("auth_failed");
  const isParse = status.endsWith("parse_failed");
  const className = isAuth
    ? "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30"
    : isParse
      ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30"
      : "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30";
  return (
    <Badge variant="outline" className={`font-mono text-[0.65rem] ${className}`}>
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

// Aggregate every LLM-queue cron job from the last 24 h to compute "analysed"
// and "failure rate" cross-domain. metadata.processed sums total per-row LLM
// invocations; auth/parse/http_fails sum per-row failures. We pull from jobs
// because the row-level tables have no per-row failure timestamp — markFailed
// in lib/admin/llm-{discover,classify,media-tier*,brreg-tier*}.ts only PATCHes
// llm_status, so aggregating over a time window means walking the jobs table.
function aggregate24h(rows: LlmJobRow[]) {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  let processed = 0;
  let fails = 0;
  for (const r of rows) {
    if (new Date(r.started_at).getTime() < cutoff) continue;
    const m = r.metadata ?? {};
    processed += numField(m.processed);
    fails +=
      numField(m.parse_fails) +
      numField(m.http_fails) +
      numField(m.auth_fails);
  }
  return { processed, fails };
}

function numField(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

// Hoisted out of the async server component so the react-hooks/purity rule
// (which flags Date.now() in component bodies) is satisfied.
function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function unwrapCount(rows: CountRow[] | { count: number }): number {
  if (Array.isArray(rows)) return rows[0]?.count ?? 0;
  return rows.count ?? 0;
}

export default async function LlmStatusPage({ searchParams }: Props) {
  const params = await searchParams;
  const cfg = mlxConfigured();

  if (!cfg) {
    return (
      <>
        <Flash searchParams={params} />
        <PageHeader
          eyebrow="Drift"
          title="AI-analyse"
          description="Status for mlx.tenki.no LLM-endepunktet."
        />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em]">
              <KeyRound className="size-3.5" />
              Ikke konfigurert
            </CardTitle>
            <CardDescription>
              Tier 1- og Tier 2-jobbene står stille til{" "}
              <code className="font-mono">MLX_API_KEY</code> er satt.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p>
              Generer en token på{" "}
              <code className="font-mono">tenki.no/admin/api-tokens/new</code>,
              lim den inn i{" "}
              <code className="font-mono">/opt/kibarometer/env/admin.env</code>{" "}
              som <code className="font-mono">MLX_API_KEY=tnk_…</code>, og
              re-deploy. <code className="font-mono">deploy.sh</code> propagerer
              verdien til{" "}
              <code className="font-mono">.env.production</code> via samme
              upsert-mønster som <code className="font-mono">UMAMI_*</code>.
            </p>
            <p className="text-muted-foreground">
              I lokal utvikling: oppdater{" "}
              <code className="font-mono">.env.local</code> og restart{" "}
              <code className="font-mono">pnpm dev</code>.
            </p>
          </CardContent>
        </Card>
      </>
    );
  }

  const sinceIso = isoHoursAgo(24);

  const [
    health,
    navT1Rows,
    navT2Rows,
    mediaUrlPendingRows,
    mediaT1Rows,
    mediaT2Rows,
    brregRolesPendingRows,
    brregT1Rows,
    brregT2Rows,
    authFailedRows,
    failureRows,
    llmJobs,
    claudeDrainJobs,
  ] = await Promise.all([
    readMlxHealth(),
    sbFetch<CountRow[] | { count: number }>(
      `/nav_postings?tier1_completed_at=is.null&llm_retry_count=lt.3&ingest_mode=eq.live&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => [] as CountRow[]),
    sbFetch<CountRow[] | { count: number }>(
      `/nav_postings?is_ai=is.true&tier2_completed_at=is.null&llm_retry_count=lt.3&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => [] as CountRow[]),
    sbFetch<CountRow[] | { count: number }>(
      `/media_url_queue?status=eq.pending&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => [] as CountRow[]),
    sbFetch<CountRow[] | { count: number }>(
      `/media_articles?deleted_at=is.null&is_ai_related=is.true&tier1_completed_at=is.null&llm_retry_count=lt.3&ingest_mode=eq.live&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => [] as CountRow[]),
    sbFetch<CountRow[] | { count: number }>(
      `/media_articles?deleted_at=is.null&tier1_completed_at=not.is.null&tier2_completed_at=is.null&llm_retry_count=lt.3&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => [] as CountRow[]),
    sbFetch<CountRow[] | { count: number }>(
      `/brreg_url_queue?status=eq.pending&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => [] as CountRow[]),
    sbFetch<CountRow[] | { count: number }>(
      `/brreg_companies?is_ai_relevant=is.true&tier1_completed_at=is.null&llm_retry_count=lt.3&ingest_mode=eq.live&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => [] as CountRow[]),
    sbFetch<CountRow[] | { count: number }>(
      `/brreg_companies?is_ai_relevant=is.true&tier1_completed_at=not.is.null&tier2_completed_at=is.null&llm_retry_count=lt.3&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => [] as CountRow[]),
    sbFetch<{ id: string }[]>(
      `/nav_postings?llm_status=in.(${AUTH_FAILED_STATUSES.join(",")})&select=id&limit=1`,
      { service: true },
    ).catch(() => [] as { id: string }[]),
    sbFetch<FailureRow[]>(
      `/nav_postings?llm_status=in.(${FAILED_STATUSES.join(",")})` +
        `&select=id,title,llm_status,llm_retry_count,posted_at` +
        `&order=posted_at.desc&limit=20`,
      { service: true },
    ).catch(() => [] as FailureRow[]),
    sbFetch<LlmJobRow[]>(
      `/jobs?name=in.(${LLM_JOB_NAMES.join(",")})` +
        `&started_at=gte.${encodeURIComponent(sinceIso)}` +
        `&select=name,status,started_at,metadata&order=started_at.desc&limit=600`,
      { service: true },
    ).catch(() => [] as LlmJobRow[]),
    sbFetch<ClaudeDrainJobRow[]>(
      `/jobs?name=in.(${CLAUDE_DRAIN_JOB_NAMES.join(",")})` +
        `&select=id,name,status,started_at,finished_at,current_step,progress_pct,metadata,rows_processed,error` +
        `&order=started_at.desc&limit=10`,
      { service: true },
    ).catch(() => [] as ClaudeDrainJobRow[]),
  ]);

  const tunnel = classifyTunnel(health?.last_success_at ?? null);
  const lastError = health?.last_error ?? null;
  const navT1 = unwrapCount(navT1Rows);
  const navT2 = unwrapCount(navT2Rows);
  const mediaUrlPending = unwrapCount(mediaUrlPendingRows);
  const mediaT1 = unwrapCount(mediaT1Rows);
  const mediaT2 = unwrapCount(mediaT2Rows);
  const brregRolesPending = unwrapCount(brregRolesPendingRows);
  const brregT1 = unwrapCount(brregT1Rows);
  const brregT2 = unwrapCount(brregT2Rows);
  const hasAuthFailures = authFailedRows.length > 0;
  const { processed: processed24h, fails: fails24h } = aggregate24h(llmJobs);
  const failureRatePct =
    processed24h > 0 ? (fails24h / processed24h) * 100 : null;
  const claudeReady = anthropicConfigured() != null;
  const navDrain = pickLatestDrainJob(claudeDrainJobs, NAV_CLAUDE_JOB_NAME);
  const brregDrain = pickLatestDrainJob(claudeDrainJobs, BRREG_CLAUDE_JOB_NAME);
  const anyDrainLive = isLiveDrain(navDrain) || isLiveDrain(brregDrain);

  return (
    <>
      <AutoRefresh enabled intervalMs={30000} />
      <Flash searchParams={params} />
      <PageHeader
        eyebrow="Drift"
        title="AI-analyse"
        description="Status for mlx.tenki.no LLM-endepunktet — på tvers av alle domener. Auto-oppdaterer hvert 30. sekund."
      />

      {hasAuthFailures ? (
        <Card className="mb-6 border-rose-500/40 bg-rose-500/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-rose-700 dark:text-rose-400">
              <AlertTriangle className="size-3.5" />
              Token trukket tilbake eller ugyldig
            </CardTitle>
            <CardDescription className="text-rose-700/90 dark:text-rose-400/90">
              Stillinger har feilet med <code className="font-mono">auth_failed</code>.
              Generer ny token på{" "}
              <code className="font-mono">tenki.no/admin/api-tokens/new</code>,
              oppdater <code className="font-mono">MLX_API_KEY</code> i{" "}
              <code className="font-mono">/opt/kibarometer/env/admin.env</code>,
              og re-deploy.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <h2 className="mb-3 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-muted-foreground">
        Generelt
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Tunnel"
          value={tunnelBadge(tunnel)}
          hint={
            health?.last_success_at
              ? `Siste suksess ${fmtDateTime(health.last_success_at)}`
              : "Ingen vellykkede kall registrert"
          }
        />
        <StatCard
          label="Modell"
          value={
            <span className="font-mono text-base">
              {health?.model_id ?? "—"}
            </span>
          }
          hint={`Endepunkt: ${cfg.baseUrl}`}
        />
        <StatCard
          label="Analysert 24t"
          value={processed24h.toLocaleString("nb-NO")}
          hint={`${llmJobs.length} jobb-kjøringer på tvers av domener`}
        />
        <StatCard
          label="Feilrate 24t"
          value={
            failureRatePct == null ? "—" : `${failureRatePct.toFixed(1)} %`
          }
          hint={
            processed24h > 0
              ? `${fails24h} feil av ${processed24h} kall`
              : "Ingen kjøringer ennå"
          }
        />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard
          label="Siste feil"
          value={
            health?.last_failure_at ? fmtDateTime(health.last_failure_at) : "—"
          }
          hint={lastError ? truncate(lastError, 80) : "Ingen feil registrert"}
        />
        <StatCard
          label="Sist oppdatert"
          value={health ? fmtDateTime(health.updated_at) : "—"}
          hint="Bumpes ved hvert kall (suksess eller feil)"
        />
      </div>

      <h2 className="mt-8 mb-3 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-muted-foreground">
        Per domene
      </h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <DomainQueueCard
          icon={<Briefcase className="size-3.5" />}
          title="Arbeidsmarked"
          subtitle="NAV-stillinger"
          rows={[
            { label: "Tier 1-kø", value: navT1 },
            { label: "Tier 2-kø", value: navT2 },
          ]}
          href="/admin/job-market/queue"
        />
        <DomainQueueCard
          icon={<Newspaper className="size-3.5" />}
          title="Mediedekning"
          subtitle="Artikler"
          rows={[
            { label: "URL-kø (pending)", value: mediaUrlPending },
            { label: "Tier 1-kø", value: mediaT1 },
            { label: "Tier 2-kø", value: mediaT2 },
          ]}
          href="/admin/media/queue"
        />
        <DomainQueueCard
          icon={<Building2 className="size-3.5" />}
          title="Oppstart"
          subtitle="Brreg-foretak"
          rows={[
            { label: "Roller-kø (pending)", value: brregRolesPending },
            { label: "Tier 1-kø", value: brregT1 },
            { label: "Tier 2-kø", value: brregT2 },
          ]}
          href="/admin/startups/queue"
        />
      </div>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em]">
            <ListChecks className="size-3.5" />
            Diagnostikk
          </CardTitle>
          <CardDescription>
            Endepunkt-ping for å bekrefte tunnel + tokens. Manuelle Tier 1- /
            Tier 2-bursts ligger per domene-kø.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <form action={pingAction}>
            <SubmitButton variant="outline" size="sm" pendingLabel="Tester…">
              {tunnel === "red" || tunnel === "unknown" ? (
                <WifiOff />
              ) : (
                <Wifi />
              )}
              Ping endepunkt
            </SubmitButton>
          </form>
        </CardContent>
      </Card>

      {anyDrainLive ? <AutoRefresh enabled intervalMs={15000} /> : null}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em]">
            <Sparkles className="size-3.5" />
            Backfill via Claude
          </CardTitle>
          <CardDescription>
            Manuell drainering av Tier 2-køen for NAV og Oppstart via
            Anthropic Claude Haiku 4.5. Ett trykk → bakgrunnsjobb som kjører
            til hele backloggen er tom (eller du stopper). Hvert trykk
            drainer kun den valgte pillaren — og media holder seg på MLX.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!claudeReady ? (
            <Alert>
              <KeyRound />
              <AlertTitle>ANTHROPIC_API_KEY mangler</AlertTitle>
              <AlertDescription>
                Sett <code className="font-mono">ANTHROPIC_API_KEY</code> i{" "}
                <code className="font-mono">/opt/kibarometer/env/admin.env</code>{" "}
                og re-deploy for å aktivere manuell backfill-drainering.
                Sjekk Anthropic-tier-nivå før store drains —{" "}
                <code className="font-mono">ANTHROPIC_CONCURRENCY</code> kan
                senkes via env hvis Tier 1.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <ClaudeDrainPillar
                pillar="nav"
                label="Arbeidsmarked (NAV)"
                backlog={navT2}
                job={navDrain}
              />
              <ClaudeDrainPillar
                pillar="brreg"
                label="Oppstart (Brreg)"
                backlog={brregT2}
                job={brregDrain}
              />
            </>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6 gap-0 p-0">
        <CardHeader className="px-6 py-4">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.14em]">
              <Bot className="size-4" />
              NAV: Feilede rader (siste 20)
            </CardTitle>
            <span className="text-xs text-muted-foreground">
              {failureRows.length}{" "}
              {failureRows.length === 1 ? "rad" : "rader"}
            </span>
          </div>
        </CardHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Stilling</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Forsøk</TableHead>
                <TableHead>Postet</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {failureRows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="py-12 text-center text-muted-foreground"
                  >
                    Ingen feilede stillinger.
                  </TableCell>
                </TableRow>
              ) : (
                failureRows.map((r) => {
                  const retry = r.llm_retry_count ?? 0;
                  return (
                    <TableRow key={r.id}>
                      <TableCell
                        className="max-w-md truncate"
                        title={r.title ?? r.id}
                      >
                        {r.title ?? (
                          <span className="font-mono text-xs">{r.id}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.llm_status ? statusBadge(r.llm_status) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {retry >= 3 ? (
                          <span className="text-destructive">{retry}/3</span>
                        ) : (
                          <span className="text-muted-foreground">
                            {retry}/3
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {r.posted_at ? fmtDateTime(r.posted_at) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
        <CardFooter className="flex flex-wrap gap-x-4 gap-y-1 border-t px-6 py-3 text-xs text-muted-foreground">
          <span>Andre domeners feil:</span>
          <Link
            href="/admin/media/queue"
            className="inline-flex items-center gap-1 text-foreground hover:underline"
          >
            Mediefeil <ArrowRight className="size-3" />
          </Link>
          <Link
            href="/admin/startups/queue"
            className="inline-flex items-center gap-1 text-foreground hover:underline"
          >
            Brreg-feil <ArrowRight className="size-3" />
          </Link>
        </CardFooter>
      </Card>

      {lastError ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em]">
              <AlertTriangle className="size-3.5" />
              Siste feilmelding fra endepunktet
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-xs">
              {lastError}
            </pre>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}

type DomainQueueCardProps = {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  rows: { label: string; value: number }[];
  href: string;
};

function DomainQueueCard({
  icon,
  title,
  subtitle,
  rows,
  href,
}: DomainQueueCardProps) {
  return (
    <Card className="gap-0 p-0">
      <CardHeader className="px-6 py-4">
        <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em]">
          {icon}
          {title}
        </CardTitle>
        <CardDescription>{subtitle}</CardDescription>
      </CardHeader>
      <CardContent className="px-6 pb-4">
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li
              key={r.label}
              className="flex items-baseline justify-between py-2.5"
            >
              <span className="text-xs text-muted-foreground">{r.label}</span>
              <span className="text-xl font-semibold tabular-nums">
                {r.value.toLocaleString("nb-NO")}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter className="border-t px-6 py-3">
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-xs font-medium text-foreground transition-opacity hover:opacity-80"
        >
          Gå til kø
          <ArrowRight className="size-3.5" />
        </Link>
      </CardFooter>
    </Card>
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

type ClaudeDrainPillarProps = {
  pillar: "nav" | "brreg";
  label: string;
  backlog: number;
  job: ClaudeDrainJobRow | null;
};

function ClaudeDrainPillar({
  pillar,
  label,
  backlog,
  job,
}: ClaudeDrainPillarProps) {
  const live = isLiveDrain(job);
  const recentlyFinished = !live && isRecentlyFinished(job);
  const pct = job ? progressPctNumber(job.progress_pct) : 0;

  return (
    <div className="rounded-md border bg-card/50 p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          <Badge variant="outline" className="font-mono text-[0.65rem]">
            {backlog.toLocaleString("nb-NO")} i kø
          </Badge>
        </div>
        {live ? (
          <Badge
            variant="outline"
            className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 font-mono text-[0.65rem]"
          >
            Pågår
          </Badge>
        ) : null}
      </div>

      {live && job ? (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">
            {job.current_step ?? "Starter…"}
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-foreground transition-[width]"
              style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
            />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <form action={stopClaudeDrainAction}>
              <input type="hidden" name="pillar" value={pillar} />
              <SubmitButton
                size="sm"
                variant="outline"
                pendingLabel="Stopper…"
              >
                <StopCircle />
                Stopp drainering
              </SubmitButton>
            </form>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {recentlyFinished && job ? (
            <div className="text-xs text-muted-foreground">
              Forrige kjøring:{" "}
              <span className="text-foreground">{job.current_step}</span>
              {job.finished_at ? (
                <span> · {fmtDateTime(job.finished_at)}</span>
              ) : null}
            </div>
          ) : null}
          <form action={startClaudeDrainAction}>
            <input type="hidden" name="pillar" value={pillar} />
            <SubmitButton
              size="sm"
              disabled={backlog === 0}
              pendingLabel="Starter…"
            >
              <Sparkles />
              {backlog === 0
                ? "Ingenting i køen"
                : `Drain hele ${label}-backloggen (${backlog.toLocaleString("nb-NO")} rader)`}
            </SubmitButton>
          </form>
        </div>
      )}
    </div>
  );
}
