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
  backfillAction,
  ingestAction,
  reprocessKeywordsAction,
  runTier1Action,
  runTier2Action,
  stopReprocessAction,
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
    tier1Pending,
    tier2Pending,
    reprocessDrain,
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
    countRows(
      "brreg_companies",
      `is_ai_relevant=is.true&tier1_completed_at=is.null&llm_retry_count=lt.3`,
    ),
    countRows(
      "brreg_companies",
      `tier1_completed_at=not.is.null&tier2_completed_at=is.null&is_ai_relevant=is.true&llm_retry_count=lt.3`,
    ),
    sbFetch<{ id: string; status: string; current_step: string | null; progress_pct: number | null; metadata: Record<string, unknown> | null }[]>(
      `/jobs?name=eq.brreg_reprocess_drain&order=started_at.desc&limit=1` +
        `&select=id,status,current_step,progress_pct,metadata`,
      { service: true },
    ).catch(() => []),
    sbFetch<AppSettingsRow[]>(
      `/app_settings?id=eq.1&select=brreg_young_founder_age_max`,
      { service: true },
    ).catch(() => [] as AppSettingsRow[]),
    sbFetch<RecentCompanyRow[]>(
      `/brreg_companies?select=orgnr,navn,organisasjonsform,registrert_dato,nace_category_slug,fylke,is_ai_relevant,youngest_role_age_at_reg&order=registrert_dato.desc.nullslast,ingested_at.desc&limit=20`,
      { service: true },
    ).catch(() => [] as RecentCompanyRow[]),
    sbFetch<RecentJobRow[]>(
      `/jobs?name=in.(fetch_brreg_enheter,bootstrap_brreg,enrich_brreg_roles,refresh_brreg_snapshots,reprocess_brreg_keywords,brreg_reprocess_drain,brreg_llm_tier1,brreg_llm_tier2)&select=id,name,trigger,status,started_at,finished_at,rows_processed,current_step,error&order=started_at.desc&limit=10`,
      { service: true },
    ).catch(() => [] as RecentJobRow[]),
  ]);

  const reprocessRunning = reprocessDrain[0]?.status === "running";
  const reprocessStep = reprocessDrain[0]?.current_step ?? null;

  const aiShare30d =
    companies30d > 0
      ? `${((aiRelevant30d / companies30d) * 100).toFixed(1)} %`
      : "—";

  const youngFounderMax = settings?.[0]?.brreg_young_founder_age_max ?? 22;

  // Today's date adjusted to "yesterday" for default ingest form value
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  return (
    <>
      <Flash searchParams={params} />
      <PageHeader
        eyebrow="Oppstart"
        title="Oversikt"
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
              ? "Kjør «Backfill» for å laste hele Brreg-registeret."
              : "Hele Brreg-registeret"
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

      <h2 className="mt-8 mb-3 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-muted-foreground">
        Operasjoner
      </h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:auto-rows-fr">
        <form action={ingestAction} className="flex flex-col gap-2 rounded-md border p-4">
          <div className="text-sm font-medium">Ingest (inkrementell)</div>
          <p className="text-xs text-muted-foreground">
            Hent foretak fra brreg-API for et dato-vindu. Tomme felt =
            gårsdagen. Idempotent på orgnr. Cron kjører dette daglig
            06:30 UTC.
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
            Ingest
          </SubmitButton>
        </form>

        <form action={backfillAction} className="flex flex-col gap-2 rounded-md border p-4">
          <div className="text-sm font-medium">Backfill (bulk dump)</div>
          <p className="text-xs text-muted-foreground">
            Last ned ~200 MB JSON-dump fra brreg og last hele registeret
            (uten dato-filter). Kan ta 10–30 min. Manuell trigger; ingen
            cron. Idempotent på orgnr — trygt å kjøre på nytt.
          </p>
          <SubmitButton size="sm" variant="outline" pendingLabel="Starter…">
            Backfill
          </SubmitButton>
        </form>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Snapshot-oppfriskning ligger på{" "}
        <Link
          href="/admin/processes"
          className="underline underline-offset-2 hover:opacity-80"
        >
          Drift &gt; Prosesser
        </Link>{" "}
        som «Refresh snapshots» og kjøres på alle domener samtidig. Rolle-kø
        drainer hver time via cron — kontakt den manuelt via{" "}
        <code className="font-mono">/admin/api/jobs/brreg-roles-burst</code>{" "}
        hvis du trenger å forsere det.
      </p>

      <h2 className="mt-8 mb-3 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-muted-foreground">
        Manuelle kjøringer
      </h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:auto-rows-fr">
        <Card className="gap-3">
          <CardHeader>
            <CardTitle className="font-mono text-xs uppercase tracking-[0.18em]">
              Kjør keyword-mapping
            </CardTitle>
            <CardDescription>
              Re-tagger hele brreg_companies-tabellen mot dagens nøkkelord-
              regler. Tagger navn og aktivitet uavhengig — den genererte
              kolonnen <code className="font-mono">is_ai_relevant</code>{" "}
              oppdateres automatisk. Idempotent. Tier 1/2-kolonnene rystes
              ikke.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="text-sm text-muted-foreground">
              {reprocessRunning
                ? reprocessStep
                  ? `Kjører — ${reprocessStep}`
                  : "Kjører…"
                : "Manuell trigger — ingen cron."}
            </div>
            <div className="flex gap-2">
              <form action={reprocessKeywordsAction}>
                <SubmitButton
                  variant="outline"
                  size="sm"
                  pendingLabel="Starter…"
                  disabled={reprocessRunning}
                >
                  {reprocessRunning ? "Kjører…" : "Kjør keyword-mapping"}
                </SubmitButton>
              </form>
              {reprocessRunning ? (
                <form action={stopReprocessAction}>
                  <SubmitButton
                    variant="outline"
                    size="sm"
                    pendingLabel="Stopper…"
                  >
                    Stopp
                  </SubmitButton>
                </form>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card className="gap-3">
          <CardHeader>
            <CardTitle className="font-mono text-xs uppercase tracking-[0.18em]">
              Kjør Tier 1 (deteksjon)
            </CardTitle>
            <CardDescription>
              LLM-burst som henter ut verbatim AI-fraser fra aktivitetsteksten
              på AI-relevante selskaper der{" "}
              <code className="font-mono">tier1_completed_at</code> er null.
              Cron drainer kontinuerlig (:01,:16,:31,:46); knappen er en
              manuell drainer ved store re-deploys eller kø-pukler.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex-1 text-sm text-muted-foreground">
              {formatNum(tier1Pending)} selskaper ventende på Tier 1.
            </div>
            <form action={runTier1Action}>
              <SubmitButton
                variant="outline"
                size="sm"
                pendingLabel="Starter…"
                disabled={tier1Pending === 0}
              >
                Kjør Tier 1
              </SubmitButton>
            </form>
          </CardContent>
        </Card>

        <Card className="gap-3">
          <CardHeader>
            <CardTitle className="font-mono text-xs uppercase tracking-[0.18em]">
              Kjør Tier 2 (kategorisering)
            </CardTitle>
            <CardDescription>
              LLM-burst som plasserer AI-selskaper i{" "}
              <code className="font-mono">brreg_categories</code>-slugs og
              scorer konfidens. Cron drainer kontinuerlig
              (:07,:22,:37,:52); knappen er en manuell drainer.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex-1 text-sm text-muted-foreground">
              {formatNum(tier2Pending)} AI-selskaper ventende på Tier 2.
            </div>
            <form action={runTier2Action}>
              <SubmitButton
                variant="outline"
                size="sm"
                pendingLabel="Starter…"
                disabled={tier2Pending === 0}
              >
                Kjør Tier 2
              </SubmitButton>
            </form>
          </CardContent>
        </Card>
      </div>

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
                          href={`/admin/startups/companies/${encodeURIComponent(c.orgnr)}`}
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
              <Link href="/admin/processes" className="underline underline-offset-2">
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
        <Link href="/admin/startups/companies" className="underline underline-offset-2">
          Foretak-oversikt →
        </Link>{" "}
        ·{" "}
        <Link href="/admin/startups/queue" className="underline underline-offset-2">
          Kø-helse →
        </Link>{" "}
        ·{" "}
        <Link href="/admin/startups/categories" className="underline underline-offset-2">
          Kategorier →
        </Link>
      </p>
    </>
  );
}
