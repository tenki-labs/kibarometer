import { Activity, Database, Server } from "lucide-react";

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
import { AutoRefresh } from "@/app/admin/_components/auto-refresh";
import { sbFetch } from "@/lib/admin/sb";

export const dynamic = "force-dynamic";

type TableSizeRow = {
  schema_name: string;
  table_name: string;
  total_bytes: number;
  row_estimate: number;
};

type RecentJobRow = {
  status: string;
  started_at: string;
  finished_at: string | null;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 ? 2 : 1)} ${units[i]}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return `${h} t ${remM} min`;
}

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DiagnosticsPage({ searchParams }: Props) {
  const params = await searchParams;

  const [tableSizes, recentJobs] = await Promise.all([
    sbFetch<TableSizeRow[]>("/rpc/admin_table_sizes", {
      service: true,
      method: "POST",
      body: {},
    }).catch(() => [] as TableSizeRow[]),
    sbFetch<RecentJobRow[]>(
      "/jobs?select=status,started_at,finished_at&order=started_at.desc&limit=50",
      { service: true },
    ).catch(() => [] as RecentJobRow[]),
  ]);

  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();
  const uptimeSec = process.uptime();

  const totalBytes = tableSizes.reduce((sum, r) => sum + (r.total_bytes ?? 0), 0);
  // pg_class.reltuples is -1 for tables that have never been ANALYZE'd
  // (mostly empty auth/storage/supabase tables). Clamp negatives to 0
  // so they don't drag the total down.
  const totalRows = tableSizes.reduce(
    (sum, r) => sum + Math.max(0, r.row_estimate ?? 0),
    0,
  );

  const successCount = recentJobs.filter((r) => r.status === "success").length;
  const failedCount = recentJobs.filter((r) => r.status === "failed").length;
  const runningCount = recentJobs.filter((r) => r.status === "running").length;

  const publicTables = tableSizes.filter((r) => r.schema_name === "public");

  return (
    <>
      <AutoRefresh enabled intervalMs={30000} />
      <Flash searchParams={params} />
      <PageHeader
        eyebrow="Innsikt"
        title="Diagnostikk"
        description="Ressursforbruk for kiba-web og Postgres. Auto-oppdaterer hvert 30. sekund."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="kiba-web RSS"
          value={formatBytes(mem.rss)}
          hint={`Heap brukt: ${formatBytes(mem.heapUsed)} av ${formatBytes(mem.heapTotal)}`}
        />
        <StatCard
          label="Oppetid"
          value={formatDuration(uptimeSec)}
          hint={`Node ${process.version}`}
        />
        <StatCard
          label="Postgres totalt"
          value={formatBytes(totalBytes)}
          hint={`${publicTables.length} tabeller i public · ~${totalRows.toLocaleString("nb-NO")} rader`}
        />
        <StatCard
          label="Jobber siste 50"
          value={`${successCount}/${successCount + failedCount + runningCount}`}
          hint={
            failedCount > 0
              ? `${failedCount} feilet · ${runningCount} kjører`
              : `${runningCount} kjører nå`
          }
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em]">
              <Server className="size-3.5" />
              Prosess
            </CardTitle>
            <CardDescription>
              Snapshot fra <code className="font-mono text-xs">process.*</code>{" "}
              ved innlasting.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                <Row label="RSS" value={formatBytes(mem.rss)} />
                <Row label="Heap brukt" value={formatBytes(mem.heapUsed)} />
                <Row label="Heap totalt" value={formatBytes(mem.heapTotal)} />
                <Row label="External" value={formatBytes(mem.external)} />
                <Row
                  label="Array buffers"
                  value={formatBytes(mem.arrayBuffers)}
                />
                <Row
                  label="CPU user"
                  value={`${(cpu.user / 1_000_000).toFixed(2)} s`}
                />
                <Row
                  label="CPU system"
                  value={`${(cpu.system / 1_000_000).toFixed(2)} s`}
                />
                <Row label="Oppetid" value={formatDuration(uptimeSec)} />
                <Row label="Node" value={process.version} />
                <Row
                  label="Plattform"
                  value={`${process.platform} · ${process.arch}`}
                />
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em]">
              <Activity className="size-3.5" />
              Jobb-aktivitet (siste 50)
            </CardTitle>
            <CardDescription>
              Suksess / feil / kjører-status. Detaljer på{" "}
              <code className="font-mono text-xs">/admin/jobs</code>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                <Row label="Vellykkede" value={String(successCount)} />
                <Row label="Feilet" value={String(failedCount)} />
                <Row label="Kjører nå" value={String(runningCount)} />
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6 gap-0 p-0">
        <CardHeader className="px-6 py-4">
          <CardTitle className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.14em]">
            <Database className="size-4" />
            Postgres-tabeller — etter størrelse
          </CardTitle>
          <CardDescription className="mt-1">
            Inkluderer index- og toast-størrelse (
            <code className="font-mono text-xs">pg_total_relation_size</code>).
            Rad-estimat er fra{" "}
            <code className="font-mono text-xs">pg_class.reltuples</code>{" "}
            (oppdateres ved ANALYZE — kan være litt utdatert). Tabeller som
            aldri har vært ANALYZE&apos;d vises som <code className="font-mono text-xs">—</code>.
          </CardDescription>
        </CardHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Skjema</TableHead>
                <TableHead>Tabell</TableHead>
                <TableHead className="text-right">Størrelse</TableHead>
                <TableHead className="text-right">Rader (estimat)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tableSizes.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="py-12 text-center text-muted-foreground"
                  >
                    Ingen data — er migrasjon 0010 kjørt?
                  </TableCell>
                </TableRow>
              ) : (
                tableSizes.map((r) => (
                  <TableRow key={`${r.schema_name}.${r.table_name}`}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {r.schema_name}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.table_name}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatBytes(r.total_bytes)}
                    </TableCell>
                    <TableCell
                      className="text-right tabular-nums text-muted-foreground"
                      title={
                        r.row_estimate < 0
                          ? "Tabellen har aldri vært ANALYZE'd — Postgres vet ikke radantallet."
                          : undefined
                      }
                    >
                      {r.row_estimate < 0
                        ? "—"
                        : r.row_estimate.toLocaleString("nb-NO")}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <TableRow>
      <TableCell className="text-xs text-muted-foreground">{label}</TableCell>
      <TableCell className="text-right font-mono text-xs tabular-nums">
        {value}
      </TableCell>
    </TableRow>
  );
}
