import Link from "next/link";

import { Button } from "@/components/ui/button";
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
import { Badge } from "@/components/ui/badge";
import { Flash } from "@/app/admin/_components/flash";
import { PageHeader } from "@/app/admin/_components/page-header";
import { StatCard } from "@/app/admin/_components/stat-card";
import { StatusBadge } from "@/app/admin/_components/status-badge";
import { sbFetch } from "@/lib/admin/sb";

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

// Hoisted out of the async component so the react-hooks/purity rule doesn't
// flag the Date.now() call. Returns a "n d ago"-style label.
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

// Rolling-window cutoffs, hoisted to satisfy react-hooks/purity.
function rollingCutoffs(): { window7d: string; window30d: string } {
  const now = Date.now();
  return {
    window7d: new Date(now - 7 * 86400000).toISOString().slice(0, 10),
    window30d: new Date(now - 30 * 86400000).toISOString().slice(0, 10),
  };
}

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Count helper: PostgREST returns the total via the Content-Range header
// with `Prefer: count=exact`, but sbFetch doesn't surface headers. We use
// `?select=count` which returns [{ count: N }] on supabase 15+.
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

  const { window7d, window30d } = rollingCutoffs();

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

  const aiShare30d =
    companies30d > 0
      ? `${((aiRelevant30d / companies30d) * 100).toFixed(1)} %`
      : "—";

  const youngFounderMax = settings?.[0]?.brreg_young_founder_age_max ?? 22;

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
            . Tilgjengelig under NLOD 2.0. Operasjoner ligger på Kø.
          </span>
        }
        action={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/admin/startups/companies">Foretak</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/admin/startups/categories">Kategorier</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/admin/startups/queue">Kø</Link>
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Foretak totalt"
          value={formatNum(totalCompanies)}
          hint={
            totalCompanies === 0
              ? "Kjør «Backfill» fra Kø for å laste hele Brreg-registeret."
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
                      Ingen data ennå — kjør Backfill fra Kø.
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
    </>
  );
}
