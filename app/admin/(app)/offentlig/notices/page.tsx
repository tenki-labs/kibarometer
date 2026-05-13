import Link from "next/link";

import { Badge } from "@/components/ui/badge";
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
import { Flash } from "@/app/admin/_components/flash";
import { PageHeader } from "@/app/admin/_components/page-header";
import { cn } from "@/lib/utils";
import { sbFetch } from "@/lib/admin/sb";
import { fmtDateTime } from "@/lib/admin/flash";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type Tab = "storting" | "doffin";

type StortingSakRow = {
  sak_id: number;
  tittel: string;
  korttittel: string | null;
  henvisning: string | null;
  sesjon_id: string | null;
  komite_navn: string | null;
  sist_oppdatert_dato: string | null;
  is_ai_relevant: boolean;
  has_ai_in_title: boolean;
  has_ai_in_emner: boolean;
  tier1_completed_at: string | null;
  tier2_completed_at: string | null;
  ingest_mode: string | null;
};

type CountRow = { count: number };

function strParam(v: string | string[] | undefined): string | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] : v;
}

function isTab(s: string | null): s is Tab {
  return s === "storting" || s === "doffin";
}

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function NoticesPage({ searchParams }: Props) {
  const params = await searchParams;
  const tab = isTab(strParam(params.tab)) ? (strParam(params.tab) as Tab) : "storting";

  return (
    <>
      <Flash searchParams={params} />
      <PageHeader
        eyebrow="Offentlig sektor"
        title="Notiser & saker"
        description={
          <>
            Felles inngang til parlamentariske saker (Stortinget) og
            innkjøpsnotiser (Doffin). Doffin-fanen er tom inntil DFØ-tilgang
            er sikret.
          </>
        }
        action={
          <div className="flex gap-2">
            <TabButton
              href="/admin/offentlig/notices?tab=storting"
              active={tab === "storting"}
              label="Stortinget"
            />
            <TabButton
              href="/admin/offentlig/notices?tab=doffin"
              active={tab === "doffin"}
              label="Doffin"
            />
          </div>
        }
      />

      {tab === "storting" ? (
        <StortingTab searchParams={params} />
      ) : (
        <DoffinTab />
      )}
    </>
  );
}

function TabButton({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <Button
      asChild
      variant={active ? "default" : "outline"}
      size="sm"
      className={cn(active ? "" : "text-muted-foreground")}
    >
      <Link href={href}>{label}</Link>
    </Button>
  );
}

async function StortingTab({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const ai = strParam(searchParams.ai);
  const sesjon = strParam(searchParams.sesjon);
  const komite = strParam(searchParams.komite);
  const ingestMode = strParam(searchParams.ingest_mode);
  const page = Math.max(1, parseInt(strParam(searchParams.page) || "1", 10) || 1);

  const filters: string[] = [];
  if (ai === "1") filters.push("is_ai_relevant=is.true");
  if (sesjon) filters.push(`sesjon_id=eq.${encodeURIComponent(sesjon)}`);
  if (komite) filters.push(`komite_navn=ilike.*${encodeURIComponent(komite)}*`);
  if (ingestMode === "live" || ingestMode === "backfill") {
    filters.push(`ingest_mode=eq.${ingestMode}`);
  }

  const filterQs = filters.length ? `&${filters.join("&")}` : "";
  const offset = (page - 1) * PAGE_SIZE;

  const [rows, totalCount] = await Promise.all([
    sbFetch<StortingSakRow[]>(
      `/storting_saker?select=sak_id,tittel,korttittel,henvisning,sesjon_id,komite_navn,sist_oppdatert_dato,is_ai_relevant,has_ai_in_title,has_ai_in_emner,tier1_completed_at,tier2_completed_at,ingest_mode` +
        `&order=sist_oppdatert_dato.desc.nullslast,ingested_at.desc` +
        `&limit=${PAGE_SIZE}&offset=${offset}${filterQs}`,
      { service: true },
    ).catch(() => [] as StortingSakRow[]),
    sbFetch<CountRow[] | { count: number }>(
      `/storting_saker?select=count${filterQs}`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => null),
  ]);

  const total = Array.isArray(totalCount)
    ? totalCount[0]?.count ?? 0
    : totalCount?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const buildHref = (overrides: Record<string, string | null>) => {
    const sp = new URLSearchParams();
    sp.set("tab", "storting");
    const set = (k: string, v: string | null | undefined) => {
      if (v != null && v !== "") sp.set(k, v);
    };
    set("ai", overrides.ai ?? ai);
    set("sesjon", overrides.sesjon ?? sesjon);
    set("komite", overrides.komite ?? komite);
    set("ingest_mode", overrides.ingest_mode ?? ingestMode);
    set("page", overrides.page ?? String(page));
    return `/admin/offentlig/notices?${sp.toString()}`;
  };

  return (
    <>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="font-mono text-xs uppercase tracking-[0.18em]">
            Filtre
          </CardTitle>
          <CardDescription>
            {total.toLocaleString("nb-NO")} saker treffer · side {page} av{" "}
            {totalPages.toLocaleString("nb-NO")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action="/admin/offentlig/notices"
            method="GET"
            className="flex flex-wrap items-end gap-3"
          >
            <input type="hidden" name="tab" value="storting" />
            <div className="flex flex-col gap-1">
              <label
                htmlFor="ai"
                className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground"
              >
                AI-flagg
              </label>
              <select
                id="ai"
                name="ai"
                defaultValue={ai ?? ""}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Alle</option>
                <option value="1">Kun AI-flagget</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label
                htmlFor="sesjon"
                className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground"
              >
                Sesjon
              </label>
              <input
                id="sesjon"
                name="sesjon"
                placeholder="2024-2025"
                defaultValue={sesjon ?? ""}
                className="h-9 w-32 rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label
                htmlFor="komite"
                className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground"
              >
                Komité (delvis)
              </label>
              <input
                id="komite"
                name="komite"
                placeholder="Næring"
                defaultValue={komite ?? ""}
                className="h-9 w-40 rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label
                htmlFor="ingest_mode"
                className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground"
              >
                Ingest
              </label>
              <select
                id="ingest_mode"
                name="ingest_mode"
                defaultValue={ingestMode ?? ""}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Alle</option>
                <option value="live">live</option>
                <option value="backfill">backfill</option>
              </select>
            </div>
            <Button type="submit" variant="default" size="sm">
              Filtrer
            </Button>
            {filters.length > 0 ? (
              <Button asChild variant="ghost" size="sm">
                <Link href="/admin/offentlig/notices?tab=storting">
                  Nullstill
                </Link>
              </Button>
            ) : null}
          </form>
        </CardContent>
      </Card>

      <Card className="mt-6 gap-0 p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tittel</TableHead>
                <TableHead>Komité</TableHead>
                <TableHead>Sesjon</TableHead>
                <TableHead>Oppdatert</TableHead>
                <TableHead>Pipeline</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-12 text-center text-muted-foreground"
                  >
                    Ingen saker matcher filtrene.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((s) => (
                  <TableRow key={s.sak_id}>
                    <TableCell className="max-w-md">
                      <Link
                        href={`/admin/offentlig/notices/storting/${s.sak_id}`}
                        className="font-medium underline decoration-dotted underline-offset-4 hover:opacity-80"
                      >
                        {s.korttittel || s.tittel}
                      </Link>
                      {s.henvisning ? (
                        <div className="mt-0.5 text-[0.7rem] text-muted-foreground">
                          {s.henvisning}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {s.komite_navn ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {s.sesjon_id ?? "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {s.sist_oppdatert_dato
                        ? fmtDateTime(s.sist_oppdatert_dato)
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1 text-[0.65rem]">
                        {s.is_ai_relevant ? (
                          <Badge variant="outline" className="font-mono">
                            AI
                          </Badge>
                        ) : null}
                        {s.tier1_completed_at ? (
                          <Badge variant="outline" className="font-mono">
                            T1
                          </Badge>
                        ) : null}
                        {s.tier2_completed_at ? (
                          <Badge variant="outline" className="font-mono">
                            T2
                          </Badge>
                        ) : null}
                        {s.ingest_mode === "backfill" ? (
                          <Badge
                            variant="outline"
                            className="font-mono opacity-60"
                          >
                            backfill
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        {totalPages > 1 ? (
          <div className="flex items-center justify-between px-6 py-3 text-sm text-muted-foreground">
            <span>
              Side {page} av {totalPages}
            </span>
            <div className="flex gap-2">
              <Button asChild variant="ghost" size="sm" disabled={page <= 1}>
                <Link href={buildHref({ page: String(Math.max(1, page - 1)) })}>
                  Forrige
                </Link>
              </Button>
              <Button
                asChild
                variant="ghost"
                size="sm"
                disabled={page >= totalPages}
              >
                <Link href={buildHref({ page: String(page + 1) })}>Neste</Link>
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
    </>
  );
}

function DoffinTab() {
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Doffin — venter på DFØ-tilgang</CardTitle>
        <CardDescription>
          Doffin-halvdelen av /offentlig krever et abonnement på Notices API
          fra DFØ. Når subscription-nøkkelen er aktivert, lander ingest-koden
          og denne fanen får et reelt søkegrensesnitt.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p>Status: ingen <code className="font-mono">doffin_notices</code>-tabell ennå.</p>
        <ul className="ml-4 list-disc">
          <li>Registrering: <code className="font-mono">dof-notices-prod-api.developer.azure-api.net</code></li>
          <li>Aktivering: e-post til <code className="font-mono">ingunn.ostrem@dfo.no</code></li>
          <li>Test-miljø: <code className="font-mono">dof-notices-test-api.developer.azure-api.net</code> + <code className="font-mono">test.doffin.no</code></li>
        </ul>
      </CardContent>
    </Card>
  );
}
