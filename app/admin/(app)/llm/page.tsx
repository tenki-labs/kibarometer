import { AlertTriangle, Bot, KeyRound, Wifi, WifiOff } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Flash } from "@/app/admin/_components/flash";
import { PageHeader } from "@/app/admin/_components/page-header";
import { StatCard } from "@/app/admin/_components/stat-card";
import { SubmitButton } from "@/app/admin/_components/submit-button";
import { AutoRefresh } from "@/app/admin/_components/auto-refresh";
import { fmtDateTime } from "@/lib/admin/flash";
import { mlxConfigured, readMlxHealth } from "@/lib/admin/mlx";
import { pingAction } from "./actions";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type TunnelState = "green" | "yellow" | "red" | "unknown";

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
      className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
    },
    yellow: {
      label: "Stille",
      className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
    },
    red: {
      label: "Utilgjengelig",
      className: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30",
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

  const health = await readMlxHealth();
  const tunnel = classifyTunnel(health?.last_success_at ?? null);
  const lastError = health?.last_error ?? null;
  const looksLikeAuthFailure =
    !!lastError && /\b40[13]\b|auth/i.test(lastError);

  return (
    <>
      <AutoRefresh enabled intervalMs={30000} />
      <Flash searchParams={params} />
      <PageHeader
        eyebrow="Drift"
        title="AI-analyse"
        description="Status for mlx.tenki.no LLM-endepunktet. Auto-oppdaterer hvert 30. sekund."
      />

      {looksLikeAuthFailure ? (
        <Card className="mb-6 border-rose-500/40 bg-rose-500/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-rose-700 dark:text-rose-400">
              <AlertTriangle className="size-3.5" />
              Auth-feil oppdaget
            </CardTitle>
            <CardDescription className="text-rose-700/90 dark:text-rose-400/90">
              Tokenet kan være trukket tilbake. Generer ny på{" "}
              <code className="font-mono">tenki.no/admin/api-tokens/new</code>{" "}
              og oppdater <code className="font-mono">MLX_API_KEY</code>.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Tunnel-status"
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
          label="Siste feil"
          value={
            health?.last_failure_at
              ? fmtDateTime(health.last_failure_at)
              : "—"
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
            {tunnel === "red" || tunnel === "unknown" ? (
              <WifiOff className="size-3.5" />
            ) : (
              <Wifi className="size-3.5" />
            )}
            Test endepunkt
          </CardTitle>
          <CardDescription>
            Henter <code className="font-mono">/v1/models</code> og oppdaterer
            tunnel-statusen. Trygt å trykke når som helst — leseoperasjon, ingen
            tokens forbrukt.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={pingAction}>
            <SubmitButton variant="outline" pendingLabel="Tester…">
              <Bot />
              Ping endepunktet
            </SubmitButton>
          </form>
        </CardContent>
      </Card>

      {lastError ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em]">
              <AlertTriangle className="size-3.5" />
              Siste feilmelding
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-xs">
              {lastError}
            </pre>
          </CardContent>
        </Card>
      ) : null}

      <p className="mt-6 text-xs text-muted-foreground">
        Tier 1 (oppdagelse) og Tier 2 (klassifisering) lander i etterfølgende
        PR-er. Denne siden er foreløpig kun for verifisering av tunnelen.
      </p>
    </>
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
