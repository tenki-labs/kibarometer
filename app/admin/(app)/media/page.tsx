import Link from "next/link";
import { ArrowRight, FileText, Globe, Newspaper } from "lucide-react";

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
import { SubmitButton } from "@/app/admin/_components/submit-button";
import { sbFetch } from "@/lib/admin/sb";
import { fmtDateTime } from "@/lib/admin/flash";
import { refreshSnapshotsAction } from "./actions";

export const dynamic = "force-dynamic";

type CountRow = { count: number };

type Source = {
  id: string;
  name: string;
  domain: string;
  is_active: boolean;
  last_polled_at: string | null;
};

type RecentArticle = {
  id: string;
  headline: string | null;
  url: string;
  published_at: string | null;
  fetched_at: string;
  is_ai_related: boolean | null;
  extraction_quality: string | null;
  tier1_completed_at: string | null;
  tier2_completed_at: string | null;
  source: { name: string; domain: string } | null;
};

type IndexRow = {
  date: string;
  index_value: number;
  ai_article_count_7d: number;
  categories_above_water: number;
  categories_below_water: number;
};

function unwrapCount(rows: CountRow[] | { count: number } | null): number {
  if (!rows) return 0;
  if (Array.isArray(rows)) return rows[0]?.count ?? 0;
  return rows.count ?? 0;
}

const QUALITY_TONE: Record<string, string> = {
  full: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
  partial:
    "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
  "metadata-only":
    "border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100",
  extract_failed:
    "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-100",
};

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Compute the rolling-window cutoffs outside the component body so the
// `react-hooks/purity` rule doesn't flag the `new Date()` (mirrors the
// helper-extraction pattern in app/admin/(app)/jobs/page.tsx).
function rollingCutoffs(): { sevenDaysAgoIso: string; thirtyDaysAgoIso: string } {
  const now = Date.now();
  return {
    sevenDaysAgoIso: new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(),
    thirtyDaysAgoIso: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

export default async function MediaOverviewPage({ searchParams }: Props) {
  const sp = await searchParams;
  const { sevenDaysAgoIso, thirtyDaysAgoIso } = rollingCutoffs();

  const [
    totalArticles,
    aiArticles,
    articles7d,
    aiArticles7d,
    articles30d,
    aiArticles30d,
    queuePending,
    queueFailed,
    tier1Pending,
    tier2Pending,
    sources,
    recentArticles,
    latestIndex,
  ] = await Promise.all([
    sbFetch<CountRow[] | { count: number }>(
      `/media_articles?deleted_at=is.null&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => null),
    sbFetch<CountRow[] | { count: number }>(
      `/media_articles?deleted_at=is.null&is_ai_related=is.true&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => null),
    sbFetch<CountRow[] | { count: number }>(
      `/media_articles?deleted_at=is.null&fetched_at=gte.${encodeURIComponent(sevenDaysAgoIso)}&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => null),
    sbFetch<CountRow[] | { count: number }>(
      `/media_articles?deleted_at=is.null&is_ai_related=is.true&fetched_at=gte.${encodeURIComponent(sevenDaysAgoIso)}&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => null),
    sbFetch<CountRow[] | { count: number }>(
      `/media_articles?deleted_at=is.null&fetched_at=gte.${encodeURIComponent(thirtyDaysAgoIso)}&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => null),
    sbFetch<CountRow[] | { count: number }>(
      `/media_articles?deleted_at=is.null&is_ai_related=is.true&fetched_at=gte.${encodeURIComponent(thirtyDaysAgoIso)}&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => null),
    sbFetch<CountRow[] | { count: number }>(
      `/media_url_queue?status=eq.pending&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => null),
    sbFetch<CountRow[] | { count: number }>(
      `/media_url_queue?status=eq.failed&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => null),
    sbFetch<CountRow[] | { count: number }>(
      `/media_articles?deleted_at=is.null&is_ai_related=is.true&tier1_completed_at=is.null&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => null),
    sbFetch<CountRow[] | { count: number }>(
      `/media_articles?deleted_at=is.null&tier1_completed_at=not.is.null&tier2_completed_at=is.null&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => null),
    sbFetch<Source[]>(
      `/media_sources?select=id,name,domain,is_active,last_polled_at&order=is_active.desc,name.asc`,
      { service: true },
    ).catch(() => [] as Source[]),
    sbFetch<RecentArticle[]>(
      `/media_articles?deleted_at=is.null&order=fetched_at.desc&limit=20` +
        `&select=id,headline,url,published_at,fetched_at,is_ai_related,extraction_quality,tier1_completed_at,tier2_completed_at,` +
        `source:media_sources(name,domain)`,
      { service: true },
    ).catch(() => [] as RecentArticle[]),
    sbFetch<IndexRow[]>(
      `/media_snapshot_index?order=date.desc&limit=1&select=date,index_value,ai_article_count_7d,categories_above_water,categories_below_water`,
      { service: true },
    ).catch(() => [] as IndexRow[]),
  ]);

  const total = unwrapCount(totalArticles);
  const ai = unwrapCount(aiArticles);
  const ai7 = unwrapCount(aiArticles7d);
  const all7 = unwrapCount(articles7d);
  const ai30 = unwrapCount(aiArticles30d);
  const all30 = unwrapCount(articles30d);
  const pending = unwrapCount(queuePending);
  const failed = unwrapCount(queueFailed);
  const t1Pending = unwrapCount(tier1Pending);
  const t2Pending = unwrapCount(tier2Pending);

  const activeSources = sources.filter((s) => s.is_active).length;
  const lastPolled = sources
    .map((s) => s.last_polled_at)
    .filter((d): d is string => !!d)
    .sort()
    .pop();

  const aiShare30 = all30 > 0 ? (ai30 / all30) * 100 : 0;
  const index = latestIndex[0] ?? null;

  return (
    <>
      <Flash searchParams={sp} />
      <PageHeader
        eyebrow="Innsikt"
        title="Mediedekning"
        description="Operativ oversikt over AI-medietemperatur-pipelinen: kilder, kø, klassifisering og siste artikler. Den offentlige dashboarden ligger på /mediedekning."
        action={
          <form action={refreshSnapshotsAction}>
            <SubmitButton variant="outline" pendingLabel="Regner…">
              Regn snapshots nå
            </SubmitButton>
          </form>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Artikler totalt"
          value={total.toLocaleString("nb-NO")}
          hint={`${ai.toLocaleString("nb-NO")} AI-relaterte`}
        />
        <StatCard
          label="Siste 7 dager"
          value={ai7.toLocaleString("nb-NO")}
          hint={`${all7.toLocaleString("nb-NO")} totalt fanget`}
        />
        <StatCard
          label="AI-andel (30d)"
          value={`${aiShare30.toFixed(1)}%`}
          hint={`${ai30.toLocaleString("nb-NO")} av ${all30.toLocaleString("nb-NO")}`}
        />
        <StatCard
          label="Kibarometer-indeks"
          value={index ? index.index_value : "—"}
          hint={
            index
              ? `${index.categories_above_water} kategorier varme · ${index.categories_below_water} kalde`
              : "Snapshot ikke kjørt ennå"
          }
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em]">
              <Globe className="size-3.5" />
              Pipelinedybde
            </CardTitle>
            <CardDescription>
              Hvor langt rader har kommet i kaskaden. Dyp kø = burst-cron eller
              MLX-utfall.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                <TableRow>
                  <TableCell className="text-muted-foreground">Kø: pending</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {pending.toLocaleString("nb-NO")}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-muted-foreground">Kø: failed</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {failed.toLocaleString("nb-NO")}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-muted-foreground">
                    Venter på Tier 1
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {t1Pending.toLocaleString("nb-NO")}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-muted-foreground">
                    Venter på Tier 2
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {t2Pending.toLocaleString("nb-NO")}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em]">
              <Newspaper className="size-3.5" />
              Kilder
            </CardTitle>
            <CardDescription>
              {activeSources} aktive av {sources.length} totalt.
              {lastPolled ? ` Sist pollet: ${fmtDateTime(lastPolled)}.` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {sources.slice(0, 12).map((s) => (
                <Badge
                  key={s.id}
                  variant="outline"
                  className={s.is_active ? "" : "opacity-60"}
                >
                  {s.name}
                  {!s.is_active ? <span className="ml-1 text-muted-foreground">(av)</span> : null}
                </Badge>
              ))}
              {sources.length > 12 ? (
                <Badge variant="outline">+{sources.length - 12}</Badge>
              ) : null}
            </div>
            <Button asChild variant="outline" className="self-start">
              <Link href="/admin/media/sources">
                Administrer kilder
                <ArrowRight />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6 gap-0 p-0">
        <CardHeader className="px-6 py-4">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.14em]">
              <FileText className="size-4" />
              Siste 20 artikler
            </CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/admin/media/articles">
                Se alle
                <ArrowRight />
              </Link>
            </Button>
          </div>
        </CardHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Overskrift</TableHead>
                <TableHead>Kilde</TableHead>
                <TableHead>Publisert</TableHead>
                <TableHead>Kvalitet</TableHead>
                <TableHead>Pipeline</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentArticles.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-12 text-center text-muted-foreground"
                  >
                    Ingen artikler ennå. Trigg{" "}
                    <code className="font-mono text-xs">media-discover</code>{" "}
                    fra cron-listen for å fylle køen.
                  </TableCell>
                </TableRow>
              ) : (
                recentArticles.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="max-w-md">
                      <Link
                        href={`/admin/media/articles/${a.id}`}
                        className="font-medium underline decoration-dotted underline-offset-4 hover:opacity-80"
                      >
                        {a.headline ?? "(uten overskrift)"}
                      </Link>
                      <div className="mt-0.5 truncate text-[0.7rem] text-muted-foreground">
                        {a.url}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {a.source?.domain ?? "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {a.published_at ? fmtDateTime(a.published_at) : "—"}
                    </TableCell>
                    <TableCell>
                      {a.extraction_quality ? (
                        <Badge
                          variant="outline"
                          className={`font-mono text-[0.65rem] uppercase ${QUALITY_TONE[a.extraction_quality] ?? ""}`}
                        >
                          {a.extraction_quality}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1 text-[0.65rem]">
                        {a.is_ai_related ? (
                          <Badge variant="outline" className="font-mono">
                            AI
                          </Badge>
                        ) : null}
                        {a.tier1_completed_at ? (
                          <Badge variant="outline" className="font-mono">
                            T1
                          </Badge>
                        ) : null}
                        {a.tier2_completed_at ? (
                          <Badge variant="outline" className="font-mono">
                            T2
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
