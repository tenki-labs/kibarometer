import Link from "next/link";
import {
  AlertTriangle,
  Bot,
  KeyRound,
  ListChecks,
  Wifi,
  WifiOff,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { pingAction } from "./actions";

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

// Aggregate llm-discover + llm-classify jobs from the last 24 h to compute
// "analysed" and "failure rate". metadata.processed sums total per-row LLM
// invocations; auth/parse/http_fails sum per-row failures. We pull from jobs
// because nav_postings has no per-row failure timestamp — markFailed in
// lib/admin/llm-{discover,classify}.ts only PATCHes llm_status, so aggregating
// over a time window means walking the jobs table.
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

  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [
    health,
    tier1QueueRows,
    tier2QueueRows,
    authFailedRows,
    failureRows,
    llmJobs,
  ] = await Promise.all([
    readMlxHealth(),
    sbFetch<CountRow[] | { count: number }>(
      `/nav_postings?tier1_completed_at=is.null&llm_retry_count=lt.3&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => [] as CountRow[]),
    sbFetch<CountRow[] | { count: number }>(
      `/nav_postings?is_ai=is.true&tier2_completed_at=is.null&llm_retry_count=lt.3&select=count`,
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
      `/jobs?name=in.(llm-discover,llm-classify)` +
        `&started_at=gte.${encodeURIComponent(sinceIso)}` +
        `&select=name,status,started_at,metadata&order=started_at.desc&limit=400`,
      { service: true },
    ).catch(() => [] as LlmJobRow[]),
  ]);

  const tunnel = classifyTunnel(health?.last_success_at ?? null);
  const lastError = health?.last_error ?? null;
  const tier1Queue = unwrapCount(tier1QueueRows);
  const tier2Queue = unwrapCount(tier2QueueRows);
  const hasAuthFailures = authFailedRows.length > 0;
  const { processed: processed24h, fails: fails24h } = aggregate24h(llmJobs);
  const failureRatePct =
    processed24h > 0 ? (fails24h / processed24h) * 100 : null;

  return (
    <>
      <AutoRefresh enabled intervalMs={30000} />
      <Flash searchParams={params} />
      <PageHeader
        eyebrow="Drift"
        title="AI-analyse"
        description="Status for mlx.tenki.no LLM-endepunktet. Auto-oppdaterer hvert 30. sekund."
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
          label="Tier 1-kø"
          value={tier1Queue.toLocaleString("nb-NO")}
          hint="Stillinger ventende på oppdagelse"
        />
        <StatCard
          label="Tier 2-kø"
          value={tier2Queue.toLocaleString("nb-NO")}
          hint="AI-stillinger ventende på klassifisering"
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Analysert 24t"
          value={processed24h.toLocaleString("nb-NO")}
          hint={`${llmJobs.length} jobb-kjøringer registrert`}
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

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em]">
            <ListChecks className="size-3.5" />
            Diagnostikk
          </CardTitle>
          <CardDescription>
            Endepunkt-ping for å bekrefte tunnel + tokens. Manuelle Tier 1- /
            Tier 2-bursts ligger nå per pipeline:{" "}
            <Link href="/admin/job-market" className="underline">
              /admin/job-market
            </Link>{" "}
            for NAV,{" "}
            <Link href="/admin/media" className="underline">
              /admin/media
            </Link>{" "}
            for medie-pipelinen.
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

      <Card className="mt-6 gap-0 p-0">
        <CardHeader className="px-6 py-4">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.14em]">
              <Bot className="size-4" />
              Siste 20 feil
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

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
