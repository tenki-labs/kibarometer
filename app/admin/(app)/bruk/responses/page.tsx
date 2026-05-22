// app/admin/(app)/bruk/responses/page.tsx — paginated svar (responses) browser.
//
// Default filter: ?status=confirmed (operator's most common need). All filters
// live in the URL so deep-linking + "Eksporter utvalg" share the same surface.
//
// Filters (all optional, all URL search params):
//   status   — pending | confirmed | expired | deleted
//   bransje  — taxonomy slug or 'privatperson'
//   q2       — frequency enum (daglig / ukentlig / av-og-til / proevd-ikke-regelmessig / aldri)
//   email    — substring (case-insensitive, ilike *value*)
//   page     — 1-based pagination

import Link from "next/link";
import { redirect } from "next/navigation";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { PageHeader } from "@/app/admin/_components/page-header";
import { fmtDateTime } from "@/lib/admin/flash";
import { sbFetch } from "@/lib/admin/sb";

import {
  bulkDeleteExpiredPendingAction,
  deleteResponseAdminAction,
  resendConfirmAdminAction,
} from "../actions";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

const STATUSES = ["pending", "confirmed", "expired", "deleted"] as const;
type StatusFilter = (typeof STATUSES)[number];

const FREQUENCIES = [
  "daglig",
  "ukentlig",
  "av-og-til",
  "proevd-ikke-regelmessig",
  "aldri",
] as const;

const FREQUENCY_LABELS: Record<string, string> = {
  daglig: "Hver dag",
  ukentlig: "Ukentlig",
  "av-og-til": "Av og til",
  "proevd-ikke-regelmessig": "Prøvd",
  aldri: "Aldri",
};

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
  confirmed: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
  expired: "bg-muted text-muted-foreground",
  deleted: "bg-destructive/10 text-destructive",
};

type Row = {
  id: number;
  email: string;
  status: string;
  q1_bransje: string;
  q2_frequency: string;
  q3_tools: string[] | null;
  q4_use_cases: string[] | null;
  q5_workplace_policy: string | null;
  submitted_at: string;
  confirmed_at: string | null;
  send_attempts: number;
  last_send_error: string | null;
};

type CountResp = { count: number };

type TaxonomyRow = { slug: string; title: string };

function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 2) return email;
  return `${email.slice(0, 2)}***${email.slice(at)}`;
}

function pick(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function buildQuery(params: {
  status?: StatusFilter;
  bransje?: string;
  q2?: string;
  email?: string;
  page: number;
}): string {
  const parts: string[] = [
    "select=id,email,status,q1_bransje,q2_frequency,q3_tools,q4_use_cases,q5_workplace_policy,submitted_at,confirmed_at,send_attempts,last_send_error",
  ];
  if (params.status) parts.push(`status=eq.${params.status}`);
  if (params.bransje) parts.push(`q1_bransje=eq.${encodeURIComponent(params.bransje)}`);
  if (params.q2) parts.push(`q2_frequency=eq.${params.q2}`);
  if (params.email) parts.push(`email=ilike.*${encodeURIComponent(params.email)}*`);
  parts.push("order=submitted_at.desc");
  const offset = (params.page - 1) * PAGE_SIZE;
  parts.push(`limit=${PAGE_SIZE}`);
  parts.push(`offset=${offset}`);
  return parts.join("&");
}

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function BrukResponsesPage({ searchParams }: Props) {
  const sp = await searchParams;
  const rawStatus = pick(sp.status);
  // Default the status filter to 'confirmed' (the operator's primary lens).
  // If no status param is present, PRG-redirect with it appended so the URL
  // is shareable.
  if (rawStatus === undefined) {
    redirect("/admin/bruk/responses?status=confirmed");
  }
  const status = (
    STATUSES.includes(rawStatus as StatusFilter)
      ? (rawStatus as StatusFilter)
      : undefined
  );

  const bransje = pick(sp.bransje);
  const q2Raw = pick(sp.q2);
  const q2 = q2Raw && FREQUENCIES.includes(q2Raw as (typeof FREQUENCIES)[number])
    ? q2Raw
    : undefined;
  const email = pick(sp.email);
  const page = Math.max(1, Number(pick(sp.page) ?? 1));

  const query = buildQuery({ status, bransje, q2, email, page });

  const [rows, countResp, taxonomyRows] = await Promise.all([
    sbFetch<Row[]>(`/bruk_responses?${query}`, { service: true }).catch(
      () => [] as Row[],
    ),
    sbFetch<CountResp[] | CountResp>(
      `/bruk_responses?${query.replace(/^select=[^&]*&/, "select=count&").replace(/&limit=\d+&offset=\d+/, "")}`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => null),
    sbFetch<TaxonomyRow[]>(
      "/taxonomy_categories?retired_at=is.null&select=slug,title&order=sort_order.asc,title.asc",
      { service: true },
    ).catch(() => [] as TaxonomyRow[]),
  ]);

  const totalCount = Array.isArray(countResp)
    ? countResp[0]?.count ?? 0
    : (countResp?.count ?? 0);
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // Build URL helpers for filter form + pagination.
  const currentParams = new URLSearchParams();
  if (status) currentParams.set("status", status);
  if (bransje) currentParams.set("bransje", bransje);
  if (q2) currentParams.set("q2", q2);
  if (email) currentParams.set("email", email);

  function pageHref(p: number): string {
    const qs = new URLSearchParams(currentParams);
    qs.set("page", String(p));
    return `/admin/bruk/responses?${qs.toString()}`;
  }

  const exportHref = `/admin/api/bruk/export-filtered.csv?${currentParams.toString()}`;

  return (
    <>
      <PageHeader
        eyebrow="Bruk"
        title="Svar"
        description={
          <>
            {new Intl.NumberFormat("nb-NO").format(totalCount)} rader matcher
            filtrene. Standardvisning: bekreftede svar.
          </>
        }
        action={
          <Button asChild>
            <a href={exportHref} download>
              <Download className="size-4" /> Eksporter utvalg (CSV)
            </a>
          </Button>
        }
      />

      <Flash searchParams={sp} />

      {/* Filter card */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Filtre</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            method="get"
            action="/admin/bruk/responses"
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"
          >
            <div>
              <Label htmlFor="filter-status">Status</Label>
              <Select name="status" defaultValue={status ?? "confirmed"}>
                <SelectTrigger id="filter-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="filter-bransje">Bransje</Label>
              <Select name="bransje" defaultValue={bransje ?? "__any"}>
                <SelectTrigger id="filter-bransje">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__any">Alle</SelectItem>
                  <SelectItem value="privatperson">Privatperson</SelectItem>
                  {taxonomyRows.map((t) => (
                    <SelectItem key={t.slug} value={t.slug}>
                      {t.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="filter-q2">Hyppighet</Label>
              <Select name="q2" defaultValue={q2 ?? "__any"}>
                <SelectTrigger id="filter-q2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__any">Alle</SelectItem>
                  {FREQUENCIES.map((f) => (
                    <SelectItem key={f} value={f}>
                      {FREQUENCY_LABELS[f] ?? f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="filter-email">E-post inneholder</Label>
              <Input
                id="filter-email"
                type="text"
                name="email"
                defaultValue={email ?? ""}
                placeholder="@example.no"
              />
            </div>
            <div className="flex items-end gap-2">
              <Button type="submit">Bruk filtre</Button>
              <Button asChild variant="ghost">
                <Link href="/admin/bruk/responses?status=confirmed">
                  Tilbakestill
                </Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Results table */}
      <Card>
        <CardHeader>
          <CardTitle>Resultater · side {page} av {pageCount}</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ingen rader matcher filtrene.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Innsendt</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>E-post</TableHead>
                    <TableHead>Bransje</TableHead>
                    <TableHead>Q2</TableHead>
                    <TableHead>Q3</TableHead>
                    <TableHead>Q4</TableHead>
                    <TableHead>Q5</TableHead>
                    <TableHead>Forsøk</TableHead>
                    <TableHead className="text-right">Handlinger</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {fmtDateTime(r.submitted_at)}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[r.status] ?? ""}`}
                        >
                          {r.status}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        <details>
                          <summary className="cursor-pointer">
                            {maskEmail(r.email)}
                          </summary>
                          <span className="text-muted-foreground">
                            {r.email}
                          </span>
                        </details>
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.q1_bransje === "privatperson"
                          ? "Privatperson"
                          : r.q1_bransje}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.q2_frequency}
                      </TableCell>
                      <TableCell
                        className="text-xs text-muted-foreground"
                        title={r.q3_tools?.join(", ") ?? ""}
                      >
                        {r.q3_tools?.length ?? 0}
                      </TableCell>
                      <TableCell
                        className="text-xs text-muted-foreground"
                        title={r.q4_use_cases?.join(", ") ?? ""}
                      >
                        {r.q4_use_cases?.length ?? 0}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.q5_workplace_policy ?? "—"}
                      </TableCell>
                      <TableCell className="tabular-nums text-xs">
                        {r.send_attempts}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex gap-2">
                          {r.status === "pending" ? (
                            <form action={resendConfirmAdminAction}>
                              <input type="hidden" name="id" value={r.id} />
                              <Button
                                type="submit"
                                size="sm"
                                variant="outline"
                              >
                                Send på nytt
                              </Button>
                            </form>
                          ) : null}
                          <form action={deleteResponseAdminAction}>
                            <input type="hidden" name="id" value={r.id} />
                            <Button
                              type="submit"
                              size="sm"
                              variant="destructive"
                            >
                              Slett
                            </Button>
                          </form>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Pagination */}
          {pageCount > 1 ? (
            <div className="mt-4 flex items-center justify-between gap-4">
              <p className="text-xs text-muted-foreground">
                {new Intl.NumberFormat("nb-NO").format(totalCount)} totalt
              </p>
              <div className="flex gap-2">
                <Button asChild variant="outline" size="sm" disabled={page <= 1}>
                  <Link href={pageHref(Math.max(1, page - 1))}>Forrige</Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  disabled={page >= pageCount}
                >
                  <Link href={pageHref(Math.min(pageCount, page + 1))}>
                    Neste
                  </Link>
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Bulk action footer */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Vedlikehold</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              Sletter ventende rader eldre enn 30 dager. Cron gjør dette
              automatisk hvert 15. minutt — knappen er en manuell trygghet.
            </p>
            <form action={bulkDeleteExpiredPendingAction}>
              <Button type="submit" variant="outline">
                Slett utløpte ventende
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
