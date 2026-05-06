import { ListTodo } from "lucide-react";

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
import { JobsTable, type JobsTableRow } from "@/app/admin/_components/jobs-table";
import { PageHeader } from "@/app/admin/_components/page-header";
import { StatCard } from "@/app/admin/_components/stat-card";
import { sbFetch } from "@/lib/admin/sb";
import { fmtDateTime } from "@/lib/admin/flash";
import {
  refreshAllSnapshotsAction,
  toggleCronPausedAction,
} from "./actions";

// Drift > Prosesser. Cross-domain process history with the truly
// cross-cutting controls — global snapshot refresh and the NAV cron
// pause toggle. Per-domain operations live on their respective hub
// pages (Backfill / Reprocess at /admin/job-market, future hubs at
// /admin/media + /admin/startups). PR 3 of admin restructure trims
// this page down to those globals.

type AppSettings = { cron_paused: boolean; updated_at: string };

type SnapshotHeadline = {
  computed_for: string;
  computed_at: string;
  ai_count_7d: number;
  ai_count_30d: number;
  ai_share_30d: number;
};

type OperationCardProps = {
  title: string;
  description: React.ReactNode;
  status?: React.ReactNode;
  buttonLabel: string;
  action: () => Promise<void>;
};

function OperationCard({
  title,
  description,
  status,
  buttonLabel,
  action,
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
          <SubmitButton variant="outline" size="sm" pendingLabel="Kjører…">
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

export default async function ProcessesPage({ searchParams }: Props) {
  const params = await searchParams;

  const [rows, latestHeadline, appSettings] = await Promise.all([
    sbFetch<JobsTableRow[]>(
      `/jobs?select=id,name,trigger,status,started_at,finished_at,rows_processed,error,progress_pct,current_step&order=started_at.desc&limit=50`,
      { service: true },
    ),
    sbFetch<SnapshotHeadline[]>(
      `/snapshot_headline?order=computed_for.desc&limit=1&select=computed_for,computed_at,ai_count_7d,ai_count_30d,ai_share_30d`,
      { service: true },
    ).catch(() => [] as SnapshotHeadline[]),
    sbFetch<AppSettings[]>(
      `/app_settings?id=eq.1&select=cron_paused,updated_at`,
      { service: true },
    ).catch(() => [] as AppSettings[]),
  ]);

  const headline = latestHeadline[0] ?? null;
  const cronPaused = appSettings[0]?.cron_paused ?? false;
  const cronUpdatedAt = appSettings[0]?.updated_at ?? null;

  const successCount = rows.filter((r) => r.status === "success").length;
  const failedCount = rows.filter((r) => r.status === "failed").length;
  const runningCount = rows.filter((r) => r.status === "running").length;
  const lastSuccess = rows.find((r) => r.status === "success");

  return (
    <>
      <AutoRefresh enabled={runningCount > 0} intervalMs={3000} />
      <Flash searchParams={params} />
      <PageHeader
        eyebrow="Drift"
        title="Prosesser"
        description="Tverr-domene prosesshistorikk og globale operasjoner. Per-domene knapper (NAV backfill, media burst, brreg backfill) bor på sine respektive hub-sider."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Vellykkede"
          value={successCount}
          hint={
            lastSuccess
              ? `Sist: ${fmtDateTime(lastSuccess.started_at)}`
              : "Ingen kjøringer ennå"
          }
        />
        <StatCard
          label="Feilet"
          value={failedCount}
          hint={
            failedCount > 0
              ? "Sjekk feilmeldinger i tabellen"
              : "Ingen feil i siste 50"
          }
        />
        <StatCard
          label="Kjører nå"
          value={runningCount}
          hint={runningCount > 0 ? "Pågår" : "Klar"}
        />
        <StatCard
          label="AI-stillinger 7d"
          value={headline?.ai_count_7d ?? "—"}
          hint={
            headline
              ? `Andel 30d: ${headline.ai_share_30d != null ? (headline.ai_share_30d * 100).toFixed(2) + "%" : "—"}`
              : "Aldri kjørt"
          }
        />
      </div>

      <h2 className="mt-8 mb-3 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-muted-foreground">
        Operasjoner
      </h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:auto-rows-fr">
        <OperationCard
          title="Refresh snapshots"
          description={
            <>
              Bygger NAV-, media- og brreg-snapshots på nytt i én operasjon
              (sekvensielle RPC-kall). &lt;5 s totalt. Kjør etter en re-tag eller
              backfill-burst når du vil ha tallene oppdatert på tvers av alle
              pipelines.
            </>
          }
          status="Cron kjører per-domene 04:00 / 04:30 / 04:45 UTC."
          buttonLabel="Refresh snapshots"
          action={refreshAllSnapshotsAction}
        />
        <OperationCard
          title="NAV cron-pause"
          description="Daglig poll av NAV live head kl. 06:00 UTC + berikelse hvert 15. min. Pause hvis du trenger å fryse ingestion (NAV-utfall, debugging) — soft pause via app_settings.cron_paused."
          status={
            cronPaused
              ? `Pauset${cronUpdatedAt ? ` siden ${fmtDateTime(cronUpdatedAt)}` : ""}.`
              : `Aktiv${cronUpdatedAt ? `. Sist endret: ${fmtDateTime(cronUpdatedAt)}` : "."}`
          }
          buttonLabel={cronPaused ? "Aktiver" : "Pause"}
          action={toggleCronPausedAction}
        />
      </div>

      <Card className="mt-8 gap-0 p-0">
        <CardHeader className="px-6 py-4">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.14em]">
              <ListTodo className="size-4" />
              Siste 50 prosesser
            </CardTitle>
            <span className="text-xs text-muted-foreground">
              {rows.length} {rows.length === 1 ? "rad" : "rader"}
            </span>
          </div>
        </CardHeader>
        <JobsTable rows={rows} mode="full" emptyLabel="Ingen prosesser ennå." />
      </Card>
    </>
  );
}
