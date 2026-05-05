import Link from "next/link";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Flash } from "@/app/admin/_components/flash";
import { PageHeader } from "@/app/admin/_components/page-header";
import { StatCard } from "@/app/admin/_components/stat-card";
import { StatusBadge } from "@/app/admin/_components/status-badge";
import { SubmitButton } from "@/app/admin/_components/submit-button";
import { sbFetch } from "@/lib/admin/sb";

import {
  bootstrapAction,
  ingestAction,
  refreshSnapshotsAction,
  rolesBurstAction,
} from "./actions";

export const dynamic = "force-dynamic";

type CountRow = { count: number };

type RecentCompanyRow = {
  orgnr: string;
  navn: string;
  organisasjonsform: string | null;
  registrert_dato: string | null;
  nace_category_slug: string | null;
  fylke: string | null;
  is_ai_relevant: boolean;
  youngest_role_age_at_reg: number | null;
};

type RecentJobRow = {
  id: string;
  name: string;
  trigger: string | null;
  status: string;
  started_at: string;
  finished_at: string | null;
  rows_processed: number | null;
  current_step: string | null;
  error: string | null;
};

type AppSettingsRow = {
  brreg_bootstrap_floor_date: string;
  brreg_young_founder_age_max: number;
};

function formatNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("nb-NO");
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "akkurat nå";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} min siden`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} t siden`;
  const d = Math.floor(h / 24);
  return `${d} d siden`;
}

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Count helper: PostgREST returns the total via the Content-Range header
// with `Prefer: count=exact`, but sbFetch doesn't surface headers. We use
// a /rpc-style count via select=count() — PostgREST exposes count as an
// aggregate when you pass `select=count` plus `Prefer: count=exact`.
// Cheaper: hit the /rpc/admin_table_sizes function — but that includes
// non-public tables. Simplest for v1: /brreg_companies?select=*&head=true
// would need header parsing too. Pragmatic alternative: query
// `?select=count` returns [{ count: N }] on supabase 15+.
async function countRows(table: string, filter = ""): Promise<number> {
  try {
    const r = await sbFetch<CountRow[]>(
      `/${table}?select=count${filter ? `&${filter}` : ""}`,
      { service: true },
    );
    return r?.[0]?.count ?? 0;
  } catch {
    return 0;
  }
}

export default async function OppstartOverviewPage({ searchParams }: Props) {
  const params = await searchParams;

  const today = new Date().toISOString().slice(0, 10);
  const window7d = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const window30d = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const [
    totalCompanies,
    companies7d,
    companies30d,
    aiRelevant30d,
    queuePending,
    queueFailed,
    rolesPersisted,
    settings,
    recentCompanies,
    recentJobs,
  ] = await Promise.all([
    countRows("brreg_companies"),
    countRows("brreg_companies", `registrert_dato=gte.${window7d}`),
    countRows("brreg_companies", `registrert_dato=gte.${window30d}`),
    countRows(
      "brreg_companies",
      `is_ai_relevant=is.true&registrert_dato=gte.${window30d}`,
    ),
    countRows("brreg_url_queue", `status=eq.pending`),
    countRows("brreg_url_queue", `status=eq.failed`),
    countRows("brreg_roles"),
    sbFetch<AppSettingsRow[]>(
      `/app_settings?id=eq.1&select=brreg_bootstrap_floor_date,brreg_young_founder_age_max`,
      { service: true },
    ).catch(() => [] as AppSettingsRow[]),
    sbFetch<RecentCompanyRow[]>(
      `/brreg_companies?select=orgnr,navn,organisasjonsform,registrert_dato,nace_category_slug,fylke,is_ai_relevant,youngest_role_age_at_reg&order=registrert_dato.desc.nullslast,ingested_at.desc&limit=20`,
      { service: true },
    ).catch(() => [] as RecentCompanyRow[]),
    sbFetch<RecentJobRow[]>(
      `/jobs?name=in.(fetch_brreg_enheter,bootstrap_brreg,enrich_brreg_roles,refresh_brreg_snapshots)&select=id,name,trigger,status,started_at,finished_at,rows_processed,current_step,error&order=started_at.desc&limit=10`,
      { service: true },
    ).catch(() => [] as RecentJobRow[]),
  ]);

  const aiShare30d =
    companies30d > 0
      ? `${((aiRelevant30d / companies30d) * 100).toFixed(1)} %`
      : "—";

  const floorDate = settings?.[0]?.brreg_bootstrap_floor_date || "2018-01-01";
  const youngFounderMax = settings?.[0]?.brreg_young_founder_age_max ?? 22;

  // Today's date adjusted to "yesterday" for default ingest form value
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  return (
    <>
      <Flash searchParams={params} />
      <PageHeader
        eyebrow="Innsikt"
        title="Oppstart"
        description={
          <span>
            Nye norske foretak fra{" "}
            <a
              href="https://data.brreg.no/enhetsregisteret/api/dokumentasjon/no/index.html"
              className="underline underline-offset-2"
              target="_blank"
              rel="noopener"
            >
              Brønnøysundregistrene
            </a>
            . Tilgjengelig under NLOD 2.0.
          </span>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Foretak totalt"
          value={formatNum(totalCompanies)}
          hint={
            totalCompanies === 0
              ? "Kjør 'Bootstrap' for å fylle med historisk data."
              : `Bootstrap-grense: ${floorDate}`
          }
        />
        <StatCard
          label="Siste 30 dager"
          value={formatNum(companies30d)}
          hint={`${formatNum(companies7d)} siste 7 dager`}
        />
        <StatCard
          label="AI-relevante 30d"
          value={aiShare30d}
          hint={`${formatNum(aiRelevant30d)} av ${formatNum(companies30d)} (navn eller aktivitet)`}
        />
        <StatCard
          label="Rolle-kø"
          value={formatNum(queuePending)}
          hint={
            queueFailed > 0
              ? `${formatNum(queuePending)} venter, ${formatNum(queueFailed)} feilet`
              : `${formatNum(rolesPersisted)} roller persistert`
          }
        />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Kontroller</CardTitle>
          <CardDescription>
            Manuelle handlinger. Cron kjører ingest 06:30 UTC, rolle-kø
            12,42 hver time, og snapshot-oppfriskning 04:45 UTC.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <form action={ingestAction} className="flex flex-col gap-2 rounded-md border p-4">
            <div className="text-sm font-medium">Inkremental henting</div>
            <p className="text-xs text-muted-foreground">
              Hent foretak fra brreg-API for et dato-vindu. Tomme felt =
              gårsdagen. Idempotent på orgnr.
            </p>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div>
                <Label htmlFor="ingest-from" className="text-xs">Fra (YYYY-MM-DD)</Label>
                <Input id="ingest-from" name="from" placeholder={yesterday} />
              </div>
              <div>
                <Label htmlFor="ingest-to" className="text-xs">Til</Label>
                <Input id="ingest-to" name="to" placeholder={yesterday} />
              </div>
            </div>
            <SubmitButton size="sm" pendingLabel="Henter…">
              Hent nå
            </SubmitButton>
          </form>

          <form action={bootstrapAction} className="flex flex-col gap-2 rounded-md border p-4">
            <div className="text-sm font-medium">Bootstrap (bulk dump)</div>
            <p className="text-xs text-muted-foreground">
              Last ned ~200 MB JSON-dump fra brreg, filtrer fra
              start-dato. Kan ta 10–30 min. Manuell trigger.
            </p>
            <div>
              <Label htmlFor="bootstrap-floor" className="text-xs">
                Start-dato (default {floorDate})
              </Label>
              <Input id="bootstrap-floor" name="floor" placeholder={floorDate} />
            </div>
            <SubmitButton size="sm" variant="outline" pendingLabel="Starter…">
              Kjør bootstrap
            </SubmitButton>
          </form>

          <form action={rolesBurstAction} className="flex flex-col gap-2 rounded-md border p-4">
            <div className="text-sm font-medium">Rolle-kø burst</div>
            <p className="text-xs text-muted-foreground">
              Tøm rolle-køen raskere enn cron (K=500, 4-min budsjett).
              Kø-dybde: {formatNum(queuePending)} ventende.
            </p>
            <SubmitButton size="sm" variant="outline" pendingLabel="Starter…" disabled={queuePending === 0}>
              Kjør burst
            </SubmitButton>
          </form>

          <form action={refreshSnapshotsAction} className="flex flex-col gap-2 rounded-md border p-4">
            <div className="text-sm font-medium">Snapshot-oppfriskning</div>
            <p className="text-xs text-muted-foreground">
              Bygg om alle brreg_snapshot_* tabeller. Tar sekunder.
              Driver alt på /oppstart-siden.
            </p>
            <SubmitButton size="sm" variant="outline" pendingLabel="Oppdaterer…">
              Oppfrisk nå
            </SubmitButton>
          </form>
        </CardContent>
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Siste registrerte foretak</CardTitle>
            <CardDescription>
              De 20 sist ingesterte. Klikk orgnr for full detalj.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Orgnr</TableHead>
                  <TableHead>Navn</TableHead>
                  <TableHead>Form</TableHead>
                  <TableHead>Kategori</TableHead>
                  <TableHead>Fylke</TableHead>
                  <TableHead className="text-right">Yngste</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentCompanies.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                      Ingen data ennå — kjør 'Hent nå' eller 'Kjør bootstrap'.
                    </TableCell>
                  </TableRow>
                ) : (
                  recentCompanies.map((c) => (
                    <TableRow key={c.orgnr}>
                      <TableCell className="font-mono text-xs">
                        <Link
                          href={`/admin/oppstart/companies/${encodeURIComponent(c.orgnr)}`}
                          className="hover:underline"
                        >
                          {c.orgnr}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-[18ch] truncate text-xs">
                        {c.is_ai_relevant ? (
                          <Badge variant="secondary" className="mr-1">AI</Badge>
                        ) : null}
                        {c.navn}
                      </TableCell>
                      <TableCell className="text-xs">{c.organisasjonsform || "—"}</TableCell>
                      <TableCell className="text-xs">{c.nace_category_slug || "—"}</TableCell>
                      <TableCell className="text-xs">{c.fylke || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {c.youngest_role_age_at_reg !== null ? (
                          <span
                            className={
                              c.youngest_role_age_at_reg < youngFounderMax
                                ? "font-semibold text-amber-700 dark:text-amber-400"
                                : ""
                            }
                          >
                            {c.youngest_role_age_at_reg}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Siste jobber</CardTitle>
            <CardDescription>
              Brreg-relaterte jobs-rader (10 nyeste).{" "}
              <Link href="/admin/jobs" className="underline underline-offset-2">
                Alle jobber →
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Navn</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead className="text-right">Rader</TableHead>
                  <TableHead className="text-right">Startet</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentJobs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                      Ingen jobber ennå.
                    </TableCell>
                  </TableRow>
                ) : (
                  recentJobs.map((j) => (
                    <TableRow key={j.id}>
                      <TableCell className="text-xs">{j.name}</TableCell>
                      <TableCell>
                        <StatusBadge status={j.status} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{j.trigger || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {formatNum(j.rows_processed)}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {relativeTime(j.started_at)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        <Link href="/admin/oppstart/companies" className="underline underline-offset-2">
          Foretak-oversikt →
        </Link>{" "}
        ·{" "}
        <Link href="/admin/oppstart/queue" className="underline underline-offset-2">
          Kø-helse →
        </Link>{" "}
        ·{" "}
        <Link href="/admin/oppstart/categories" className="underline underline-offset-2">
          Kategorier →
        </Link>
      </p>
    </>
  );
}
