import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";

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
  TableRow,
} from "@/components/ui/table";
import { Flash } from "@/app/admin/_components/flash";
import { PageHeader } from "@/app/admin/_components/page-header";
import { fmtDateTime } from "@/lib/admin/flash";
import { sbFetch } from "@/lib/admin/sb";

export const dynamic = "force-dynamic";

type Article = {
  id: string;
  url: string;
  url_hash: string;
  headline: string | null;
  byline: string | null;
  language: string | null;
  word_count: number | null;
  og_image_url: string | null;
  published_at: string | null;
  last_modified_at: string | null;
  fetched_at: string;
  is_ai_related: boolean | null;
  matched_keywords: { matched?: string[]; tags?: string[] } | null;
  match_method: string | null;
  extraction_quality: string | null;
  extraction_strategy_used: string | null;
  simhash_text: string | null;
  wire_cluster_id: string | null;
  tier1_completed_at: string | null;
  llm_ai_phrases: { phrases?: string[] } | string[] | null;
  llm_retry_count: number;
  tier2_completed_at: string | null;
  llm_categories:
    | { categories?: Array<{ slug: string; confidence?: number }>; rationale?: string }
    | null;
  llm_stance: string | null;
  llm_intensity: number | null;
  llm_taxonomy_version: string | null;
  llm_model_version: string | null;
  created_at: string;
  last_seen_at: string;
  source: { name: string; domain: string } | null;
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ArticleDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;

  const rows = await sbFetch<Article[]>(
    `/media_articles?id=eq.${encodeURIComponent(id)}` +
      `&select=id,url,url_hash,headline,byline,language,word_count,og_image_url,` +
      `published_at,last_modified_at,fetched_at,` +
      `is_ai_related,matched_keywords,match_method,` +
      `extraction_quality,extraction_strategy_used,` +
      `simhash_text:simhash::text,wire_cluster_id,` +
      `tier1_completed_at,llm_ai_phrases,llm_retry_count,` +
      `tier2_completed_at,llm_categories,llm_stance,llm_intensity,` +
      `llm_taxonomy_version,llm_model_version,` +
      `created_at,last_seen_at,` +
      `source:media_sources(name,domain)`,
    { service: true },
  ).catch(() => [] as Article[]);
  const article = rows[0];
  if (!article) notFound();

  const phrases = Array.isArray(article.llm_ai_phrases)
    ? article.llm_ai_phrases
    : (article.llm_ai_phrases?.phrases ?? []);
  const cats = article.llm_categories?.categories ?? [];
  const matched = article.matched_keywords?.matched ?? [];

  return (
    <>
      <Flash searchParams={sp} />
      <PageHeader
        eyebrow="Mediedekning"
        title={article.headline ?? "(uten overskrift)"}
        description={
          <>
            <span className="font-mono">{article.source?.domain ?? "—"}</span>
            {article.byline ? <> · {article.byline}</> : null}
            {article.published_at ? (
              <> · {fmtDateTime(article.published_at)}</>
            ) : null}
          </>
        }
        action={
          <div className="flex gap-2">
            <Button asChild variant="ghost">
              <Link href="/admin/media/articles">
                <ArrowLeft />
                Tilbake
              </Link>
            </Button>
            <Button asChild variant="outline">
              <a href={article.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink />
                Åpne kilde
              </a>
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-xs uppercase tracking-[0.18em]">
              Metadata
            </CardTitle>
            <CardDescription>
              Brødteksten lagres aldri — bare faktiske metadata + avledet analyse.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                <Row label="URL">
                  <code className="break-all font-mono text-xs">{article.url}</code>
                </Row>
                <Row label="url_hash">
                  <code className="font-mono text-xs">{article.url_hash}</code>
                </Row>
                <Row label="Kilde">{article.source?.name ?? "—"}</Row>
                <Row label="Språk">{article.language ?? "—"}</Row>
                <Row label="Antall ord">{article.word_count ?? "—"}</Row>
                <Row label="Hentet">{fmtDateTime(article.fetched_at)}</Row>
                <Row label="Publisert">
                  {article.published_at ? fmtDateTime(article.published_at) : "—"}
                </Row>
                <Row label="Sist endret">
                  {article.last_modified_at
                    ? fmtDateTime(article.last_modified_at)
                    : "—"}
                </Row>
                <Row label="og:image">
                  {article.og_image_url ? (
                    <a
                      href={article.og_image_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all font-mono text-xs underline decoration-dotted"
                    >
                      {article.og_image_url}
                    </a>
                  ) : (
                    "—"
                  )}
                </Row>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-xs uppercase tracking-[0.18em]">
              Pipeline-status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                <Row label="AI-relatert">
                  {article.is_ai_related ? (
                    <Badge variant="outline" className="font-mono">
                      ja
                    </Badge>
                  ) : article.is_ai_related === false ? (
                    <Badge variant="outline" className="font-mono">
                      nei
                    </Badge>
                  ) : (
                    "—"
                  )}
                </Row>
                <Row label="match_method">
                  {article.match_method ?? "—"}
                </Row>
                <Row label="Ekstraksjon">
                  {article.extraction_quality
                    ? `${article.extraction_quality}${article.extraction_strategy_used ? ` (${article.extraction_strategy_used})` : ""}`
                    : "—"}
                </Row>
                <Row label="Tier 1">
                  {article.tier1_completed_at
                    ? fmtDateTime(article.tier1_completed_at)
                    : "—"}
                </Row>
                <Row label="Tier 2">
                  {article.tier2_completed_at
                    ? fmtDateTime(article.tier2_completed_at)
                    : "—"}
                </Row>
                <Row label="LLM-retries">{article.llm_retry_count}</Row>
                <Row label="simhash">
                  {article.simhash_text ? (
                    <code className="font-mono text-xs">
                      {article.simhash_text}
                    </code>
                  ) : (
                    "—"
                  )}
                </Row>
                <Row label="wire_cluster_id">
                  {article.wire_cluster_id ? (
                    <code className="font-mono text-xs">
                      {article.wire_cluster_id}
                    </code>
                  ) : (
                    "—"
                  )}
                </Row>
                <Row label="Modell">
                  {article.llm_model_version ?? "—"}
                </Row>
                <Row label="Taksonomi">
                  {article.llm_taxonomy_version ?? "—"}
                </Row>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-xs uppercase tracking-[0.18em]">
              Klassifisering
            </CardTitle>
            <CardDescription>
              Stance og kategorier kommer fra Tier 2 (Norwegian-language LLM-prompt).
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <div>
              <p className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
                Stance + intensitet
              </p>
              <p className="mt-1">
                {article.llm_stance ? (
                  <span className="font-mono">
                    {article.llm_stance}
                    {article.llm_intensity != null
                      ? ` · ${article.llm_intensity.toFixed(2)}`
                      : ""}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Ikke klassifisert ennå</span>
                )}
              </p>
            </div>
            <div>
              <p className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
                Kategorier
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {cats.length === 0 ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  cats.map((c) => (
                    <Badge
                      key={c.slug}
                      variant="outline"
                      className="font-mono text-[0.65rem]"
                    >
                      {c.slug}
                      {c.confidence != null
                        ? ` · ${c.confidence.toFixed(2)}`
                        : ""}
                    </Badge>
                  ))
                )}
              </div>
            </div>
            {article.llm_categories?.rationale ? (
              <div>
                <p className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
                  Begrunnelse
                </p>
                <p className="mt-1 text-sm">
                  {article.llm_categories.rationale}
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-xs uppercase tracking-[0.18em]">
              Nøkkelord og fraser
            </CardTitle>
            <CardDescription>
              Stage-2 keyword-matcher + Tier 1 LLM-frasene som passet inngangen.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <div>
              <p className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
                Matchede nøkkelord
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {matched.length === 0 ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  matched.map((m) => (
                    <Badge
                      key={m}
                      variant="outline"
                      className="font-mono text-[0.65rem]"
                    >
                      {m}
                    </Badge>
                  ))
                )}
              </div>
            </div>
            <div>
              <p className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
                LLM-fraser (Tier 1)
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {phrases.length === 0 ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  phrases.map((p) => (
                    <Badge
                      key={p}
                      variant="outline"
                      className="font-mono text-[0.65rem]"
                    >
                      {p}
                    </Badge>
                  ))
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <TableRow>
      <TableCell className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </TableCell>
      <TableCell className="text-sm">{children}</TableCell>
    </TableRow>
  );
}
