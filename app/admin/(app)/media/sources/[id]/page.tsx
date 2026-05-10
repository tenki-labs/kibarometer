import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";

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
import { PageHeader } from "@/app/admin/_components/page-header";
import { StatCard } from "@/app/admin/_components/stat-card";
import { Flash } from "@/app/admin/_components/flash";
import { fmtDateTime } from "@/lib/admin/flash";
import { sbFetch } from "@/lib/admin/sb";

export const dynamic = "force-dynamic";

const QUALITY_VALUES = ["full", "partial", "metadata-only", "extract_failed"] as const;
const STRATEGY_VALUES = [
  "jsonld",
  "amp",
  "readability",
  "og-only",
  "rendered",
] as const;

type Source = {
  id: string;
  name: string;
  domain: string;
  is_active: boolean;
  rss_url: string | null;
  backfill_cursor: string | null;
  crawl_delay_ms: number;
  last_polled_at: string | null;
  notes: string | null;
};

type CountRow = { count: number };

type Article = {
  id: string;
  headline: string | null;
  url: string;
  fetched_at: string;
  is_ai_related: boolean | null;
  extraction_quality: string | null;
  extraction_strategy_used: string | null;
};

type Failure = {
  url: string;
  attempts: number;
  discovered_at: string;
  last_error: string | null;
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function unwrap(rows: CountRow[] | { count: number } | null): number {
  if (!rows) return 0;
  if (Array.isArray(rows)) return rows[0]?.count ?? 0;
  return rows.count ?? 0;
}

export default async function MediaSourceDebugPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;

  const [rows, totalArticles, aiArticles, qualityCounts, strategyCounts, failures, recent] =
    await Promise.all([
      sbFetch<Source[]>(
        `/media_sources?id=eq.${encodeURIComponent(id)}` +
          `&select=id,name,domain,is_active,rss_url,backfill_cursor,crawl_delay_ms,last_polled_at,notes`,
        { service: true },
      ).catch(() => [] as Source[]),
      sbFetch<CountRow[] | { count: number }>(
        `/media_articles?source_id=eq.${encodeURIComponent(id)}&deleted_at=is.null&select=count`,
        { service: true, headers: { Prefer: "count=exact" } },
      ).catch(() => null),
      sbFetch<CountRow[] | { count: number }>(
        `/media_articles?source_id=eq.${encodeURIComponent(id)}&is_ai_related=is.true&deleted_at=is.null&select=count`,
        { service: true, headers: { Prefer: "count=exact" } },
      ).catch(() => null),
      Promise.all(
        QUALITY_VALUES.map((q) =>
          sbFetch<CountRow[] | { count: number }>(
            `/media_articles?source_id=eq.${encodeURIComponent(id)}` +
              `&extraction_quality=eq.${q}&deleted_at=is.null&select=count`,
            { service: true, headers: { Prefer: "count=exact" } },
          )
            .catch(() => null)
            .then((r) => [q, unwrap(r)] as const),
        ),
      ),
      Promise.all(
        STRATEGY_VALUES.map((s) =>
          sbFetch<CountRow[] | { count: number }>(
            `/media_articles?source_id=eq.${encodeURIComponent(id)}` +
              `&extraction_strategy_used=eq.${s}&deleted_at=is.null&select=count`,
            { service: true, headers: { Prefer: "count=exact" } },
          )
            .catch(() => null)
            .then((r) => [s, unwrap(r)] as const),
        ),
      ),
      sbFetch<Failure[]>(
        `/media_url_queue?source_id=eq.${encodeURIComponent(id)}&status=eq.failed` +
          `&order=discovered_at.desc&limit=10&select=url,attempts,discovered_at,last_error`,
        { service: true },
      ).catch(() => [] as Failure[]),
      sbFetch<Article[]>(
        `/media_articles?source_id=eq.${encodeURIComponent(id)}&deleted_at=is.null` +
          `&order=fetched_at.desc&limit=20` +
          `&select=id,headline,url,fetched_at,is_ai_related,extraction_quality,extraction_strategy_used`,
        { service: true },
      ).catch(() => [] as Article[]),
    ]);

  const src = rows[0];
  if (!src) notFound();

  const total = unwrap(totalArticles);
  const ai = unwrap(aiArticles);
  const aiShare = total > 0 ? (ai / total) * 100 : 0;

  return (
    <>
      <Flash searchParams={sp} />
      <PageHeader
        eyebrow="Mediedekning · Kilder"
        title={src.name}
        description={`${src.domain}${src.is_active ? "" : " · INAKTIV"}`}
        action={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/admin/media/sources">
                <ArrowLeft />
                Tilbake
              </Link>
            </Button>
            <Button asChild>
              <Link href={`/admin/media/sources/${src.id}/edit`}>
                <Pencil />
                Rediger
              </Link>
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Artikler totalt"
          value={total.toLocaleString("nb-NO")}
          hint={`${ai.toLocaleString("nb-NO")} AI-relaterte (${aiShare.toFixed(1)}%)`}
        />
        <StatCard
          label="Crawl-delay"
          value={`${src.crawl_delay_ms} ms`}
          hint="Mellom hver fetch"
        />
        <StatCard
          label="Backfill-cursor"
          value={src.backfill_cursor ?? "—"}
          hint={src.backfill_cursor ? "Sist nådd" : "Ikke kjørt"}
        />
        <StatCard
          label="Sist pollet"
          value={src.last_polled_at ? "✓" : "—"}
          hint={src.last_polled_at ? fmtDateTime(src.last_polled_at) : "Aldri"}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-xs uppercase tracking-[0.18em]">
              Ekstraksjonskvalitet
            </CardTitle>
            <CardDescription>
              Distribusjonen av extraction_quality på artikler fra denne kilden.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                {qualityCounts.map(([q, n]) => {
                  const pct = total > 0 ? (n / total) * 100 : 0;
                  return (
                    <TableRow key={q}>
                      <TableCell className="font-mono text-xs">{q}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {n.toLocaleString("nb-NO")}
                      </TableCell>
                      <TableCell className="w-32 text-right text-xs text-muted-foreground tabular-nums">
                        {pct.toFixed(1)}%
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-xs uppercase tracking-[0.18em]">
              Vinnende strategi
            </CardTitle>
            <CardDescription>
              Hvilke strategier i ekstraksjonskaskaden lykkes oftest? Lav
              jsonld-andel + høy og-only kan bety at outletten har lagt ned
              JSON-LD.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                {strategyCounts.map(([s, n]) => {
                  const pct = total > 0 ? (n / total) * 100 : 0;
                  return (
                    <TableRow key={s}>
                      <TableCell className="font-mono text-xs">{s}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {n.toLocaleString("nb-NO")}
                      </TableCell>
                      <TableCell className="w-32 text-right text-xs text-muted-foreground tabular-nums">
                        {pct.toFixed(1)}%
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6 gap-0 p-0">
        <CardHeader className="px-6 py-4">
          <CardTitle className="font-mono text-[0.7rem] uppercase tracking-[0.14em]">
            Siste 20 artikler
          </CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Overskrift</TableHead>
                <TableHead>Hentet</TableHead>
                <TableHead>Kvalitet</TableHead>
                <TableHead>Strategi</TableHead>
                <TableHead>AI</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-12 text-center text-muted-foreground">
                    Ingen artikler ennå.
                  </TableCell>
                </TableRow>
              ) : (
                recent.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="max-w-md">
                      <Link
                        href={`/admin/media/articles/${a.id}`}
                        className="font-medium underline decoration-dotted underline-offset-4 hover:opacity-80"
                      >
                        {a.headline ?? "(uten overskrift)"}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {fmtDateTime(a.fetched_at)}
                    </TableCell>
                    <TableCell className="font-mono text-[0.65rem]">
                      {a.extraction_quality ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-[0.65rem] text-muted-foreground">
                      {a.extraction_strategy_used ?? "—"}
                    </TableCell>
                    <TableCell>
                      {a.is_ai_related ? (
                        <Badge variant="outline" className="font-mono text-[0.6rem]">
                          AI
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {failures.length > 0 ? (
        <Card className="mt-6 gap-0 p-0">
          <CardHeader className="px-6 py-4">
            <CardTitle className="font-mono text-[0.7rem] uppercase tracking-[0.14em]">
              Siste feilede henting (10)
            </CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>URL</TableHead>
                  <TableHead className="text-right">Forsøk</TableHead>
                  <TableHead>Feil</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {failures.map((f) => (
                  <TableRow key={f.url}>
                    <TableCell className="max-w-md truncate font-mono text-[0.7rem]">
                      <a href={f.url} target="_blank" rel="noopener noreferrer">
                        {f.url}
                      </a>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {f.attempts}
                    </TableCell>
                    <TableCell className="max-w-sm truncate text-xs text-rose-600 dark:text-rose-400">
                      {f.last_error ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      ) : null}
    </>
  );
}
