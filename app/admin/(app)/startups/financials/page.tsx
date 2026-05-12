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
import { Flash } from "@/app/admin/_components/flash";
import { PageHeader } from "@/app/admin/_components/page-header";
import { StatCard } from "@/app/admin/_components/stat-card";
import { StatusBadge } from "@/app/admin/_components/status-badge";
import { SubmitButton } from "@/app/admin/_components/submit-button";
import { sbFetch } from "@/lib/admin/sb";

import {
  refreshFinancialSnapshotsAction,
  triggerFinancialDrainAction,
} from "./actions";

export const dynamic = "force-dynamic";

type CountRow = { count: number };

type FetchStateBreakdownRow = {
  last_fetch_status: "OK" | "NO_FILINGS" | "HTTP_ERROR";
  count: number;
};

type RecentFinancialRow = {
  orgnr: string;
  fiscal_year: number;
  sum_driftsinntekter: number | null;
  driftsresultat: number | null;
  aarsresultat: number | null;
  gjennomsnittlig_antall_ansatte: number | null;
  fetched_at: string;
};

type RecentErrorRow = {
  orgnr: string;
  last_fetch_status: string;
  last_fetch_error: string | null;
  last_fetch_attempt_at: string;
};

type YearlyRow = {
  fiscal_year: number;
  is_ai_relevant: boolean;
  company_count: number;
  sum_omsetning: number;
  gini_omsetning: number | null;
  top10_share: number | null;
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

const NB = new Intl.NumberFormat("nb-NO");

function formatNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return NB.format(n);
}

function formatNok(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)} mrd`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} mill`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)} k`;
  return NB.format(n);
}

function formatPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${(n * 100).toFixed(1)} %`;
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

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function FinancialsPage({ searchParams }: Props) {
  const params = await searchParams;

  const [
    aiFlagged,
    fetched,
    financialsRows,
    okRows,
    noFilingsRows,
    errorRows,
    yearlyRows,
    recentFinancials,
    recentErrors,
    recentJobs,
  ] = await Promise.all([
    countRows("brreg_companies", `is_ai_relevant=is.true`),
    countRows("brreg_financials_fetch_state"),
    countRows("brreg_financials"),
    countRows("brreg_financials_fetch_state", `last_fetch_status=eq.OK`),
    countRows("brreg_financials_fetch_state", `last_fetch_status=eq.NO_FILINGS`),
    countRows("brreg_financials_fetch_state", `last_fetch_status=eq.HTTP_ERROR`),
    sbFetch<YearlyRow[]>(
      `/brreg_snapshot_financials_yearly?select=fiscal_year,is_ai_relevant,company_count,sum_omsetning,gini_omsetning,top10_share&order=fiscal_year.desc,is_ai_relevant.desc&limit=20`,
      { service: true },
    ).catch(() => [] as YearlyRow[]),
    sbFetch<RecentFinancialRow[]>(
      `/brreg_financials?select=orgnr,fiscal_year,sum_driftsinntekter,driftsresultat,aarsresultat,gjennomsnittlig_antall_ansatte,fetched_at&order=fetched_at.desc&limit=20`,
      { service: true },
    ).catch(() => [] as RecentFinancialRow[]),
    sbFetch<RecentErrorRow[]>(
      `/brreg_financials_fetch_state?last_fetch_status=eq.HTTP_ERROR&select=orgnr,last_fetch_status,last_fetch_error,last_fetch_attempt_at&order=last_fetch_attempt_at.desc&limit=10`,
      { service: true },
    ).catch(() => [] as RecentErrorRow[]),
    sbFetch<RecentJobRow[]>(
      `/jobs?name=eq.brreg_financials_drain&select=id,name,trigger,status,started_at,finished_at,rows_processed,current_step,error&order=started_at.desc&limit=10`,
      { service: true },
    ).catch(() => [] as RecentJobRow[]),
  ]);

  const remaining = Math.max(0, aiFlagged - fetched);
  const coveragePct =
    aiFlagged > 0 ? `${((fetched / aiFlagged) * 100).toFixed(1)} %` : "—";

  return (
    <>
      <Flash searchParams={params} />
      <PageHeader
        eyebrow="Oppstart"
        title="Finansial data"
        description={
          <span>
            Årsregnskap fra{" "}
            <a
              href="https://data.brreg.no/regnskapsregisteret/"
              className="underline underline-offset-2"
              target="_blank"
              rel="noopener"
            >
              Regnskapsregisteret
            </a>{" "}
            for AI-flagga foretak. NLOD 2.0. Tickes hver time (:18); 180 dagers
            re-fetch per orgnr. Små AS under regnskapsplikt og ENK leverer
            ikke — dette er en kjent dekningssvakhet.
          </span>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="AI-flagga foretak"
          value={formatNum(aiFlagged)}
          hint="Drain-pool — hver hentes 1× per 180d"
        />
        <StatCard
          label="Forsøkt"
          value={coveragePct}
          hint={`${formatNum(fetched)} av ${formatNum(aiFlagged)} (${formatNum(remaining)} igjen)`}
        />
        <StatCard
          label="Med innleverte regnskap"
          value={formatNum(okRows)}
          hint={
            noFilingsRows > 0
              ? `${formatNum(noFilingsRows)} uten innleveringer`
              : "OK status"
          }
        />
        <StatCard
          label="HTTP-feil"
          value={formatNum(errorRows)}
          hint={
            errorRows > 0
              ? "Sjekk feiltabellen nedenfor"
              : "Ingen feil i siste batch"
          }
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Trigg drain</CardTitle>
            <CardDescription>
              Hent neste K foretak fra Regnskapsregisteret. K=50 standard;
              maks 200 per tick. Annual data — flertallet av ticks blir no-op
              når backfill er ajour.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={triggerFinancialDrainAction} className="flex items-end gap-3">
              <div className="grid gap-2">
                <Label htmlFor="k">Antall (K)</Label>
                <Input
                  id="k"
                  name="k"
                  type="number"
                  min={1}
                  max={200}
                  defaultValue={50}
                  className="w-24"
                />
              </div>
              <SubmitButton pendingLabel="Starter…">Drain</SubmitButton>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Snapshot-refresh</CardTitle>
            <CardDescription>
              Beregner alle brreg-snapshots på nytt — inkluderer de to nye
              financials-tabellene (yearly + cohort). Tar sekunder.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={refreshFinancialSnapshotsAction}>
              <SubmitButton variant="outline" pendingLabel="Regner…">
                Refresh snapshots
              </SubmitButton>
            </form>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Per år, AI vs basislinje</CardTitle>
            <CardDescription>
              Fra brreg_snapshot_financials_yearly. AI = is_ai_relevant=true.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>År</TableHead>
                  <TableHead>Subset</TableHead>
                  <TableHead className="text-right">Selskaper</TableHead>
                  <TableHead className="text-right">Sum omsetning</TableHead>
                  <TableHead className="text-right">Gini</TableHead>
                  <TableHead className="text-right">Topp 10</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {yearlyRows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center text-sm text-muted-foreground"
                    >
                      Ingen aggregat ennå — trigg drain + refresh snapshot.
                    </TableCell>
                  </TableRow>
                ) : (
                  yearlyRows.map((r) => (
                    <TableRow key={`${r.fiscal_year}-${r.is_ai_relevant}`}>
                      <TableCell className="text-xs">{r.fiscal_year}</TableCell>
                      <TableCell className="text-xs">
                        {r.is_ai_relevant ? "AI" : "Basislinje"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {formatNum(r.company_count)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {formatNok(r.sum_omsetning)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {r.gini_omsetning !== null
                          ? r.gini_omsetning.toFixed(3).replace(".", ",")
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {formatPct(r.top10_share)}
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
            <CardTitle>Siste innleveringer</CardTitle>
            <CardDescription>
              20 nyest persisterte rader i brreg_financials.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Orgnr</TableHead>
                  <TableHead>År</TableHead>
                  <TableHead className="text-right">Omsetning</TableHead>
                  <TableHead className="text-right">Drift</TableHead>
                  <TableHead className="text-right">Ansatte</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentFinancials.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-center text-sm text-muted-foreground"
                    >
                      Ingen data ennå.
                    </TableCell>
                  </TableRow>
                ) : (
                  recentFinancials.map((r) => (
                    <TableRow key={`${r.orgnr}-${r.fiscal_year}`}>
                      <TableCell className="font-mono text-xs">
                        {r.orgnr}
                      </TableCell>
                      <TableCell className="text-xs">{r.fiscal_year}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {formatNok(r.sum_driftsinntekter)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {formatNok(r.driftsresultat)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {formatNum(r.gjennomsnittlig_antall_ansatte)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {recentErrors.length > 0 ? (
        <div className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Siste feil</CardTitle>
              <CardDescription>
                HTTP-feil ved henting fra Regnskapsregisteret. Retries om 180
                dager — kjør manuell drain for å forsøke nå.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Orgnr</TableHead>
                    <TableHead>Feil</TableHead>
                    <TableHead className="text-right">Forsøkt</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentErrors.map((r) => (
                    <TableRow key={r.orgnr}>
                      <TableCell className="font-mono text-xs">
                        {r.orgnr}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.last_fetch_error || "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {relativeTime(r.last_fetch_attempt_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <div className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Siste drain-jobber</CardTitle>
            <CardDescription>
              brreg_financials_drain-jobber (10 nyeste).
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Steg</TableHead>
                  <TableHead className="text-right">Rader</TableHead>
                  <TableHead className="text-right">Startet</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentJobs.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-center text-sm text-muted-foreground"
                    >
                      Ingen jobber ennå.
                    </TableCell>
                  </TableRow>
                ) : (
                  recentJobs.map((j) => (
                    <TableRow key={j.id}>
                      <TableCell>
                        <StatusBadge status={j.status} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {j.trigger || "—"}
                      </TableCell>
                      <TableCell className="max-w-[40ch] truncate text-xs text-muted-foreground">
                        {j.current_step || j.error || "—"}
                      </TableCell>
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
    </>
  );
}
