import Link from "next/link";
import { ChevronLeft, ChevronRight, FileText, RefreshCcw } from "lucide-react";

import { SubmitButton } from "@/app/admin/_components/submit-button";
import {
  bulkReclassifyAllAction,
  bulkReclassifyTier2Action,
} from "./actions";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Flash } from "@/app/admin/_components/flash";
import { MediaSourcesArticlesTabs } from "@/app/admin/_components/media-sources-articles-tabs";
import { PageHeader } from "@/app/admin/_components/page-header";
import { fmtDateTime } from "@/lib/admin/flash";
import { sbFetch } from "@/lib/admin/sb";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type Article = {
  id: string;
  headline: string | null;
  url: string;
  published_at: string | null;
  fetched_at: string;
  is_ai_related: boolean | null;
  extraction_quality: string | null;
  extraction_strategy_used: string | null;
  llm_stance: string | null;
  llm_intensity: number | null;
  llm_categories: { categories?: Array<{ slug: string }> } | null;
  tier1_completed_at: string | null;
  tier2_completed_at: string | null;
  source: { id: string; name: string; domain: string } | null;
};

type Source = { id: string; name: string };

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const QUALITY_TONE: Record<string, string> = {
  full: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
  partial:
    "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
  "metadata-only":
    "border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100",
  extract_failed:
    "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-100",
};

function pickStr(
  sp: Record<string, string | string[] | undefined>,
  key: string,
): string {
  const v = sp[key];
  if (Array.isArray(v)) return v[0] ?? "";
  return v ?? "";
}

export default async function ArticlesPage({ searchParams }: Props) {
  const sp = await searchParams;

  const rawSource = pickStr(sp, "source");
  const sourceId = rawSource && rawSource !== "__all" ? rawSource : "";
  const aiOnly = pickStr(sp, "ai") === "1";
  const q = pickStr(sp, "q").trim();
  const pageStr = pickStr(sp, "page");
  const page = Math.max(1, Number.parseInt(pageStr, 10) || 1);

  // Build the filter clause once. PostgREST `or=…` for free-text search needs
  // a literal `*…*` for ilike; we URL-encode the * so PostgREST sees the
  // wildcard, not a glob.
  const clauses: string[] = ["deleted_at=is.null"];
  if (sourceId) clauses.push(`source_id=eq.${encodeURIComponent(sourceId)}`);
  if (aiOnly) clauses.push("is_ai_related=is.true");
  if (q) {
    const like = `*${q}*`;
    clauses.push(`headline=ilike.${encodeURIComponent(like)}`);
  }
  const filter = clauses.join("&");

  const offset = (page - 1) * PAGE_SIZE;

  const [articles, sources] = await Promise.all([
    sbFetch<Article[]>(
      `/media_articles?${filter}` +
        `&select=id,headline,url,published_at,fetched_at,is_ai_related,extraction_quality,extraction_strategy_used,` +
        `llm_stance,llm_intensity,llm_categories,tier1_completed_at,tier2_completed_at,` +
        `source:media_sources(id,name,domain)` +
        `&order=fetched_at.desc&limit=${PAGE_SIZE}&offset=${offset}`,
      { service: true },
    ).catch(() => [] as Article[]),
    sbFetch<Source[]>(
      `/media_sources?select=id,name&order=name.asc`,
      { service: true },
    ).catch(() => [] as Source[]),
  ]);

  const hasMore = articles.length === PAGE_SIZE;

  // Preserve filters when paginating.
  const baseQs = new URLSearchParams();
  if (sourceId) baseQs.set("source", sourceId);
  if (aiOnly) baseQs.set("ai", "1");
  if (q) baseQs.set("q", q);
  const linkFor = (p: number) => {
    const qs = new URLSearchParams(baseQs);
    qs.set("page", String(p));
    return `/admin/media/articles?${qs.toString()}`;
  };

  return (
    <>
      <Flash searchParams={sp} />
      <PageHeader
        eyebrow="Medie-dekning"
        title="Kilder & artikler"
        description="Alle medierader pipelinen har samlet inn — metadata + avledet analyse, aldri brødtekst."
      />
      <MediaSourcesArticlesTabs current="articles" />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="font-mono text-xs uppercase tracking-[0.18em]">
            Filtre
          </CardTitle>
          <CardDescription>
            Søk treffer overskriften (case-insensitive, substring).
          </CardDescription>
        </CardHeader>
        <form
          method="get"
          action="/admin/media/articles"
          className="grid grid-cols-1 gap-4 px-6 pb-6 sm:grid-cols-2 lg:grid-cols-4"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="q">Overskrift</Label>
            <Input
              id="q"
              name="q"
              defaultValue={q}
              placeholder="kunstig intelligens"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="source">Kilde</Label>
            <Select name="source" defaultValue={sourceId || "__all"}>
              <SelectTrigger id="source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Alle kilder</SelectItem>
                {sources.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ai">AI-relaterte</Label>
            <Select name="ai" defaultValue={aiOnly ? "1" : "__any"}>
              <SelectTrigger id="ai">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__any">Alle</SelectItem>
                <SelectItem value="1">Bare AI-relaterte</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <Button type="submit">Filtrér</Button>
            <Button asChild variant="ghost">
              <Link href="/admin/media/articles">Tilbakestill</Link>
            </Button>
          </div>
        </form>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em]">
            <RefreshCcw className="size-3.5" />
            Bulk-handlinger
          </CardTitle>
          <CardDescription>
            Kjøres på alle rader som matcher filtrene over. Re-klassifisering
            er ikke-destruktivt — Tier 2 plukker opp resatte rader på neste
            cron-tikk eller via &quot;Burst T2&quot; på{" "}
            <Link href="/admin/media" className="underline">
              /admin/media
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <div className="flex flex-wrap items-center gap-2 px-6 pb-6">
          <form action={bulkReclassifyTier2Action}>
            <input type="hidden" name="q" value={q} />
            <input type="hidden" name="source" value={sourceId} />
            <input type="hidden" name="ai" value={aiOnly ? "1" : ""} />
            <SubmitButton variant="outline" pendingLabel="Resetter…">
              Reset Tier 2 (filter)
            </SubmitButton>
          </form>
          <form action={bulkReclassifyAllAction}>
            <input type="hidden" name="q" value={q} />
            <input type="hidden" name="source" value={sourceId} />
            <input type="hidden" name="ai" value={aiOnly ? "1" : ""} />
            <SubmitButton variant="outline" pendingLabel="Resetter…">
              Reset Tier 1 + 2 (filter)
            </SubmitButton>
          </form>
        </div>
      </Card>

      <Card className="gap-0 p-0">
        <CardHeader className="px-6 py-4">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.14em]">
              <FileText className="size-4" />
              Side {page}
            </CardTitle>
            <span className="text-xs text-muted-foreground">
              {articles.length}{" "}
              {articles.length === 1 ? "artikkel" : "artikler"} på denne siden
            </span>
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
                <TableHead>Kategorier</TableHead>
                <TableHead>Stance</TableHead>
                <TableHead>Pipeline</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {articles.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-12 text-center text-muted-foreground"
                  >
                    Ingen artikler matcher filteret.
                  </TableCell>
                </TableRow>
              ) : (
                articles.map((a) => {
                  const cats = a.llm_categories?.categories ?? [];
                  return (
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
                        <div className="flex max-w-[16rem] flex-wrap gap-1">
                          {cats.length === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            cats.map((c) => (
                              <Badge
                                key={c.slug}
                                variant="outline"
                                className="font-mono text-[0.6rem]"
                              >
                                {c.slug}
                              </Badge>
                            ))
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {a.llm_stance ? (
                          <span className="font-mono">
                            {a.llm_stance}
                            {a.llm_intensity != null
                              ? ` · ${a.llm_intensity.toFixed(2)}`
                              : ""}
                          </span>
                        ) : (
                          "—"
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
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <div className="mt-4 flex items-center justify-between">
        <Button asChild variant="outline" size="sm" disabled={page <= 1}>
          {page > 1 ? (
            <Link href={linkFor(page - 1)}>
              <ChevronLeft />
              Forrige
            </Link>
          ) : (
            <span>
              <ChevronLeft />
              Forrige
            </span>
          )}
        </Button>
        <span className="text-xs text-muted-foreground">Side {page}</span>
        <Button asChild variant="outline" size="sm" disabled={!hasMore}>
          {hasMore ? (
            <Link href={linkFor(page + 1)}>
              Neste
              <ChevronRight />
            </Link>
          ) : (
            <span>
              Neste
              <ChevronRight />
            </span>
          )}
        </Button>
      </div>
    </>
  );
}
