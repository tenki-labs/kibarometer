import Link from "next/link";
import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { fmtDateTime } from "@/lib/admin/flash";
import { sbFetch } from "@/lib/admin/sb";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type Posting = {
  id: string;
  title: string | null;
  employer_name: string | null;
  status: string | null;
  source_url: string | null;
  posted_at: string | null;
  is_ai: boolean;
  tier1_completed_at: string | null;
  tier2_completed_at: string | null;
  matched_keywords: string[];
  location_county: string | null;
  location_municipality: string | null;
};

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function single(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? "";
  return v ?? "";
}

// PostgREST encodes commas inside `or=(...)` filters by URL-encoding the
// outer parens. Building the filter string by hand keeps the fetch URL
// readable in logs and avoids URLSearchParams's eager encoding.
function buildFilter(
  q: string,
  status: string,
  ai: string,
): string {
  const parts: string[] = [];
  if (q) {
    const escaped = q.replace(/[*,()]/g, " ").trim();
    if (escaped) {
      const term = `*${escaped}*`;
      parts.push(`or=(title.ilike.${term},employer_name.ilike.${term})`);
    }
  }
  if (status === "active") parts.push("status=eq.ACTIVE");
  else if (status === "inactive") parts.push("status=eq.INACTIVE");
  if (ai === "ai") parts.push("is_ai=is.true");
  else if (ai === "non-ai") parts.push("is_ai=is.false&tier1_completed_at=not.is.null");
  else if (ai === "unclassified") parts.push("tier1_completed_at=is.null");
  return parts.join("&");
}

export default async function NavPostingsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const q = single(sp.q);
  const status = single(sp.status) || "all";
  const ai = single(sp.ai) || "all";
  const page = Math.max(1, parseInt(single(sp.page) || "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const filter = buildFilter(q, status, ai);
  const filterQs = filter ? `&${filter}` : "";

  const [rows, totalRows] = await Promise.all([
    sbFetch<Posting[]>(
      `/nav_postings?select=id,title,employer_name,status,source_url,posted_at,is_ai,tier1_completed_at,tier2_completed_at,matched_keywords,location_county,location_municipality` +
        `&order=posted_at.desc.nullslast` +
        `&limit=${PAGE_SIZE}&offset=${offset}` +
        filterQs,
      { service: true },
    ).catch(() => [] as Posting[]),
    sbFetch<{ count: number }[] | { count: number }>(
      `/nav_postings?select=count${filterQs}`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => [] as { count: number }[]),
  ]);

  const total = Array.isArray(totalRows)
    ? (totalRows[0] as { count: number } | undefined)?.count ?? rows.length
    : 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Build URL with current filters preserved for the prev/next links.
  function pageUrl(p: number): string {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status && status !== "all") params.set("status", status);
    if (ai && ai !== "all") params.set("ai", ai);
    if (p !== 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/admin/job-market/postings?${qs}` : "/admin/job-market/postings";
  }

  return (
    <>
      <Flash searchParams={sp} />
      <PageHeader
        eyebrow="Arbeidsmarked"
        title="Stillinger"
        description={`NAV-stillinger ingested fra stillingsfeed. ${total.toLocaleString("nb-NO")} totalt med dagens filter.`}
      />

      <Card className="mb-4">
        <CardHeader className="pb-4">
          <CardTitle className="font-mono text-[0.7rem] uppercase tracking-[0.14em]">
            Filter
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            method="get"
            action="/admin/job-market/postings"
            className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-3"
          >
            <div className="flex-1">
              <label
                htmlFor="q"
                className="block pb-1.5 text-xs text-muted-foreground"
              >
                Søk i tittel eller arbeidsgiver
              </label>
              <Input
                id="q"
                name="q"
                defaultValue={q}
                placeholder="f.eks. Equinor, ML engineer …"
              />
            </div>
            <div className="sm:w-44">
              <label
                htmlFor="status"
                className="block pb-1.5 text-xs text-muted-foreground"
              >
                Status
              </label>
              <select
                id="status"
                name="status"
                defaultValue={status}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
              >
                <option value="all">Alle</option>
                <option value="active">Aktive</option>
                <option value="inactive">Utløpte</option>
              </select>
            </div>
            <div className="sm:w-48">
              <label
                htmlFor="ai"
                className="block pb-1.5 text-xs text-muted-foreground"
              >
                AI-status
              </label>
              <select
                id="ai"
                name="ai"
                defaultValue={ai}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
              >
                <option value="all">Alle</option>
                <option value="ai">AI-relevant</option>
                <option value="non-ai">Ikke AI</option>
                <option value="unclassified">Uklassifisert</option>
              </select>
            </div>
            <div className="flex gap-2">
              <Button type="submit" variant="default">
                Bruk filter
              </Button>
              {(q || status !== "all" || ai !== "all") && (
                <Button asChild variant="ghost">
                  <Link href="/admin/job-market/postings">Nullstill</Link>
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="gap-0 p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tittel</TableHead>
                <TableHead>Arbeidsgiver</TableHead>
                <TableHead>Sted</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>AI</TableHead>
                <TableHead>Postet</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-12 text-center text-muted-foreground"
                  >
                    Ingen treff med dagens filter.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="max-w-md">
                      {p.source_url ? (
                        <a
                          href={p.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 truncate text-sm hover:opacity-80"
                        >
                          <span className="truncate">
                            {p.title ?? "(uten tittel)"}
                          </span>
                          <ExternalLink className="size-3 shrink-0" />
                        </a>
                      ) : (
                        <span className="truncate text-sm">
                          {p.title ?? "(uten tittel)"}
                        </span>
                      )}
                      {p.matched_keywords.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {p.matched_keywords.slice(0, 4).map((kw) => (
                            <Badge
                              key={kw}
                              variant="outline"
                              className="font-mono text-[0.65rem]"
                            >
                              {kw}
                            </Badge>
                          ))}
                          {p.matched_keywords.length > 4 && (
                            <span className="text-[0.65rem] text-muted-foreground">
                              +{p.matched_keywords.length - 4}
                            </span>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {p.employer_name ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {[p.location_municipality, p.location_county]
                        .filter(Boolean)
                        .join(", ") || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          p.status === "ACTIVE" ? "default" : "outline"
                        }
                        className="font-mono text-[0.65rem]"
                      >
                        {p.status ?? "—"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {p.tier1_completed_at == null ? (
                        <Badge
                          variant="outline"
                          className="font-mono text-[0.65rem] text-muted-foreground"
                        >
                          uklassifisert
                        </Badge>
                      ) : p.is_ai ? (
                        <Badge className="font-mono text-[0.65rem]">AI</Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="font-mono text-[0.65rem] text-muted-foreground"
                        >
                          ikke-AI
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {p.posted_at ? fmtDateTime(p.posted_at) : "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between border-t px-6 py-3 text-xs text-muted-foreground">
          <span>
            Side {page} av {totalPages.toLocaleString("nb-NO")} ·{" "}
            {total.toLocaleString("nb-NO")} stillinger
          </span>
          <div className="flex items-center gap-2">
            {page > 1 ? (
              <Button asChild size="sm" variant="outline">
                <Link href={pageUrl(page - 1)}>
                  <ArrowLeft />
                  Forrige
                </Link>
              </Button>
            ) : null}
            {page < totalPages ? (
              <Button asChild size="sm" variant="outline">
                <Link href={pageUrl(page + 1)}>
                  Neste
                  <ArrowRight />
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      </Card>
    </>
  );
}
