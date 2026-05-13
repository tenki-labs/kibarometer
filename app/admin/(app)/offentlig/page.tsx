import Link from "next/link";
import { FileText, Gavel, Landmark, RefreshCw } from "lucide-react";

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
import { StatCard } from "@/app/admin/_components/stat-card";
import { sbFetch } from "@/lib/admin/sb";
import { fmtDateTime } from "@/lib/admin/flash";
import {
  refreshSnapshotsAction,
  runStortingBackfillAction,
  burstStortingTier1Action,
  burstStortingTier2Action,
  reprocessKeywordsAction,
} from "./actions";

export const dynamic = "force-dynamic";

type CountRow = { count: number };

type RecentSak = {
  sak_id: number;
  tittel: string;
  korttittel: string | null;
  sist_oppdatert_dato: string | null;
  sesjon_id: string | null;
  komite_navn: string | null;
  is_ai_relevant: boolean;
  tier1_completed_at: string | null;
  tier2_completed_at: string | null;
  ingest_mode: string | null;
};

type Headline = {
  computed_for: string;
  computed_at: string;
  total_saker_ai: number | null;
  total_saker_ai_12m: number | null;
  total_saker_ai_prior_12m: number | null;
  debate_yoy_pct: number | null;
  top_komite_navn: string | null;
  top_komite_count: number | null;
};

function unwrapCount(rows: CountRow[] | { count: number } | null): number {
  if (!rows) return 0;
  if (Array.isArray(rows)) return rows[0]?.count ?? 0;
  return rows.count ?? 0;
}

function rollingCutoffs(): { sevenDaysAgoIso: string; thirtyDaysAgoIso: string } {
  const now = Date.now();
  return {
    sevenDaysAgoIso: new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(),
    thirtyDaysAgoIso: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function OffentligOverviewPage({ searchParams }: Props) {
  const sp = await searchParams;
  const { sevenDaysAgoIso, thirtyDaysAgoIso } = rollingCutoffs();
  const sevenDayDate = sevenDaysAgoIso.slice(0, 10);
  const thirtyDayDate = thirtyDaysAgoIso.slice(0, 10);

  const [
    totalSaker,
    aiSaker,
    aiSaker7d,
    aiSaker30d,
    tier2Done,
    recentSaker,
    headlineRows,
  ] = await Promise.all([
    sbFetch<CountRow[] | { count: number }>(
      `/storting_saker?select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => null),
    sbFetch<CountRow[] | { count: number }>(
      `/storting_saker?is_ai_relevant=is.true&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => null),
    sbFetch<CountRow[] | { count: number }>(
      `/storting_saker?is_ai_relevant=is.true&sist_oppdatert_dato=gte.${sevenDayDate}&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => null),
    sbFetch<CountRow[] | { count: number }>(
      `/storting_saker?is_ai_relevant=is.true&sist_oppdatert_dato=gte.${thirtyDayDate}&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => null),
    sbFetch<CountRow[] | { count: number }>(
      `/storting_saker?is_ai_relevant=is.true&tier2_completed_at=not.is.null&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => null),
    sbFetch<RecentSak[]>(
      `/storting_saker?order=ingested_at.desc&limit=20` +
        `&select=sak_id,tittel,korttittel,sist_oppdatert_dato,sesjon_id,komite_navn,is_ai_relevant,tier1_completed_at,tier2_completed_at,ingest_mode`,
      { service: true },
    ).catch(() => [] as RecentSak[]),
    sbFetch<Headline[]>(
      `/offentlig_snapshot_headline?order=computed_for.desc&limit=1` +
        `&select=computed_for,computed_at,total_saker_ai,total_saker_ai_12m,total_saker_ai_prior_12m,debate_yoy_pct,top_komite_navn,top_komite_count`,
      { service: true },
    ).catch(() => [] as Headline[]),
  ]);

  const total = unwrapCount(totalSaker);
  const ai = unwrapCount(aiSaker);
  const ai7 = unwrapCount(aiSaker7d);
  const ai30 = unwrapCount(aiSaker30d);
  const tier2 = unwrapCount(tier2Done);
  const headline = headlineRows[0] ?? null;

  const aiShareOfTotal = total > 0 ? (ai / total) * 100 : 0;
  const tier2Pct = ai > 0 ? (tier2 / ai) * 100 : 0;

  return (
    <>
      <Flash searchParams={sp} />
      <PageHeader
        eyebrow="Offentlig sektor"
        title="Stortinget — oversikt"
        description={
          <>
            Operativ oversikt over Stortinget-pipelinen: saker, vedtak, klassifisering
            og snapshots. Doffin-halvdelen lander når DFØ-tilgang er sikret.
          </>
        }
        action={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/admin/offentlig/notices">
                <FileText className="size-3.5" />
                Notiser & saker
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/admin/offentlig/queue">Kø</Link>
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Saker totalt"
          value={total.toLocaleString("nb-NO")}
          hint={`${ai.toLocaleString("nb-NO")} AI-flagget (${aiShareOfTotal.toFixed(1)}%)`}
        />
        <StatCard
          label="Siste 30 dager"
          value={ai30.toLocaleString("nb-NO")}
          hint={`${ai7.toLocaleString("nb-NO")} siste 7 dager`}
        />
        <StatCard
          label="Tier 2 dekning"
          value={`${tier2Pct.toFixed(0)}%`}
          hint={`${tier2.toLocaleString("nb-NO")} av ${ai.toLocaleString("nb-NO")} AI-saker kategorisert`}
        />
        <StatCard
          label="Debatt YoY"
          value={
            headline?.debate_yoy_pct != null
              ? `${headline.debate_yoy_pct >= 0 ? "+" : ""}${Number(headline.debate_yoy_pct).toFixed(1)}%`
              : "—"
          }
          hint={
            headline
              ? `12m: ${headline.total_saker_ai_12m ?? 0} · forrige 12m: ${headline.total_saker_ai_prior_12m ?? 0}`
              : "Snapshot ikke kjørt ennå"
          }
        />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em]">
            <Landmark className="size-3.5" />
            Topp komité (siste 24 mnd)
          </CardTitle>
          <CardDescription>
            {headline?.top_komite_navn
              ? `${headline.top_komite_navn} — ${headline.top_komite_count ?? 0} AI-flaggede saker`
              : "Snapshot ikke kjørt ennå — kjør 'Oppdater snapshots' under for å regne ut."}
          </CardDescription>
        </CardHeader>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em]">
            <Gavel className="size-3.5" />
            Operasjoner
          </CardTitle>
          <CardDescription>
            Manuelle triggere — speiler crontab-ene. Skipper stille når{" "}
            <code className="font-mono">MLX_API_KEY</code> ikke er satt.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <form action={refreshSnapshotsAction}>
            <Button variant="outline" type="submit">
              <RefreshCw className="size-3.5" />
              Oppdater snapshots
            </Button>
          </form>
          <form action={runStortingBackfillAction}>
            <Button variant="outline" type="submit">
              Kjør backfill (2018-2019 → nå)
            </Button>
          </form>
          <form action={burstStortingTier1Action}>
            <Button variant="outline" type="submit">
              Burst Tier 1 (K=100)
            </Button>
          </form>
          <form action={burstStortingTier2Action}>
            <Button variant="outline" type="submit">
              Burst Tier 2 (K=20)
            </Button>
          </form>
          <form action={reprocessKeywordsAction}>
            <Button variant="outline" type="submit">
              Re-tag mot nøkkelord-katalog
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="mt-6 gap-0 p-0">
        <CardHeader className="px-6 py-4">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.14em]">
              <FileText className="size-4" />
              Siste 20 saker
            </CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/admin/offentlig/notices">Se alle</Link>
            </Button>
          </div>
        </CardHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tittel</TableHead>
                <TableHead>Komité</TableHead>
                <TableHead>Oppdatert</TableHead>
                <TableHead>Sesjon</TableHead>
                <TableHead>Pipeline</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentSaker.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-12 text-center text-muted-foreground"
                  >
                    Ingen saker ennå. Kjør{" "}
                    <code className="font-mono text-xs">
                      offentlig-storting-fetch
                    </code>{" "}
                    fra cron eller bruk Backfill-knappen.
                  </TableCell>
                </TableRow>
              ) : (
                recentSaker.map((s) => (
                  <TableRow key={s.sak_id}>
                    <TableCell className="max-w-md">
                      <Link
                        href={`/admin/offentlig/notices/storting/${s.sak_id}`}
                        className="font-medium underline decoration-dotted underline-offset-4 hover:opacity-80"
                      >
                        {s.korttittel || s.tittel}
                      </Link>
                      {s.korttittel && s.korttittel !== s.tittel ? (
                        <div className="mt-0.5 truncate text-[0.7rem] text-muted-foreground">
                          {s.tittel}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {s.komite_navn ?? "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {s.sist_oppdatert_dato
                        ? fmtDateTime(s.sist_oppdatert_dato)
                        : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {s.sesjon_id ?? "—"}
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
                          <Badge variant="outline" className="font-mono opacity-60">
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
      </Card>
    </>
  );
}
