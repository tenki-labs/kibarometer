import Link from "next/link";
import { ArrowRight, Download, Plus, Power, Rss } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
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
import { MediaSourcesArticlesTabs } from "@/app/admin/_components/media-sources-articles-tabs";
import { PageHeader } from "@/app/admin/_components/page-header";
import { StatCard } from "@/app/admin/_components/stat-card";
import { SubmitButton } from "@/app/admin/_components/submit-button";
import { fmtDateTime } from "@/lib/admin/flash";
import { sbFetch } from "@/lib/admin/sb";
import { backfillSourceAction, toggleActiveAction } from "./actions";

export const dynamic = "force-dynamic";

type Source = {
  id: string;
  name: string;
  domain: string;
  rss_url: string | null;
  crawl_delay_ms: number;
  is_active: boolean;
  last_polled_at: string | null;
  backfill_cursor: string | null;
  notes: string | null;
};

type QueueRow = { source_id: string; status: string };

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function single(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? "";
  return v ?? "";
}

// Filter clause builder. Mirrors /admin/job-market/postings — same
// pattern (or= for ilike across name+domain, plus optional status).
// Building by hand instead of URLSearchParams to keep the encoded URL
// readable and avoid double-encoding the * wildcard.
function buildFilter(q: string, status: string): string {
  const parts: string[] = [];
  if (q) {
    const escaped = q.replace(/[*,()]/g, " ").trim();
    if (escaped) {
      const term = `*${escaped}*`;
      parts.push(`or=(name.ilike.${term},domain.ilike.${term})`);
    }
  }
  if (status === "active") parts.push("is_active=eq.true");
  else if (status === "inactive") parts.push("is_active=eq.false");
  return parts.join("&");
}

export default async function MediaSourcesPage({ searchParams }: Props) {
  const sp = await searchParams;
  const q = single(sp.q);
  const status = single(sp.status) || "all";

  const filter = buildFilter(q, status);
  const filterQs = filter ? `&${filter}` : "";

  const [sources, queueRows] = await Promise.all([
    sbFetch<Source[]>(
      `/media_sources?select=id,name,domain,rss_url,crawl_delay_ms,is_active,last_polled_at,backfill_cursor,notes` +
        `&order=is_active.desc,name.asc` +
        filterQs,
      { service: true },
    ).catch(() => [] as Source[]),
    sbFetch<QueueRow[]>(
      `/media_url_queue?select=source_id,status&limit=10000`,
      { service: true },
    ).catch(() => [] as QueueRow[]),
  ]);

  // Per-source queue depths (pending / failed). 10k row cap is a soft guard;
  // if a single source pushes us past that we have bigger problems.
  const queueBySource = new Map<string, { pending: number; failed: number }>();
  for (const r of queueRows) {
    const cur = queueBySource.get(r.source_id) ?? { pending: 0, failed: 0 };
    if (r.status === "pending") cur.pending += 1;
    else if (r.status === "failed") cur.failed += 1;
    queueBySource.set(r.source_id, cur);
  }

  const active = sources.filter((s) => s.is_active);
  const inactive = sources.filter((s) => !s.is_active);

  const totalForStats = sources;
  const filterApplied = q !== "" || status !== "all";

  return (
    <>
      <Flash searchParams={sp} />
      <PageHeader
        eyebrow="Medie-dekning"
        title="Kilder & artikler"
        description="Norske medieoutletter pipelinen poller, og artiklene de leverer. URL-oppdaging kjøres via kiba-scraper-sidecaren (scrapegraph) — ingen per-outlet konfig nødvendig."
        action={
          <Button asChild>
            <Link href="/admin/media/sources/new">
              <Plus />
              Ny kilde
            </Link>
          </Button>
        }
      />
      <MediaSourcesArticlesTabs current="sources" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard
          label="Aktive kilder"
          value={active.length}
          hint={`${inactive.length} inaktive`}
        />
        <StatCard
          label="Med RSS"
          value={totalForStats.filter((s) => s.rss_url).length}
          hint="Daglig discover-cron poller disse"
        />
      </div>

      <Card className="mt-6">
        <CardHeader className="pb-4">
          <CardTitle className="font-mono text-[0.7rem] uppercase tracking-[0.14em]">
            Filter
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            method="get"
            action="/admin/media/sources"
            className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-3"
          >
            <div className="flex-1">
              <label
                htmlFor="q"
                className="block pb-1.5 text-xs text-muted-foreground"
              >
                Søk i navn eller domene
              </label>
              <Input
                id="q"
                name="q"
                defaultValue={q}
                placeholder="f.eks. afte, bt.no, tek …"
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
                <option value="inactive">Inaktive</option>
              </select>
            </div>
            <div className="flex gap-2">
              <Button type="submit" variant="default">
                Bruk filter
              </Button>
              {filterApplied && (
                <Button asChild variant="ghost">
                  <Link href="/admin/media/sources">Nullstill</Link>
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      {sources.length === 0 ? (
        <Card className="mt-6">
          <CardContent className="py-12 text-center text-muted-foreground">
            {filterApplied
              ? "Ingen treff med dagens filter."
              : "Ingen kilder ennå."}
          </CardContent>
        </Card>
      ) : null}

      {active.length > 0 ? (
        <SourcesSection
          title="Aktive"
          count={active.length}
          tone="primary"
          rows={active}
          queueBySource={queueBySource}
        />
      ) : null}

      {inactive.length > 0 ? (
        <SourcesSection
          title="Inaktive"
          count={inactive.length}
          tone="muted"
          rows={inactive}
          queueBySource={queueBySource}
        />
      ) : null}
    </>
  );
}

function SourcesSection({
  title,
  count,
  tone,
  rows,
  queueBySource,
}: {
  title: string;
  count: number;
  tone: "primary" | "muted";
  rows: Source[];
  queueBySource: Map<string, { pending: number; failed: number }>;
}) {
  return (
    <Card className="mt-6 gap-0 p-0">
      <CardHeader className="px-6 py-4">
        <CardTitle
          className={
            "flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.14em] " +
            (tone === "muted" ? "text-muted-foreground" : "")
          }
        >
          <Rss className="size-4" />
          {title} ({count})
        </CardTitle>
        <CardDescription className="mt-1">
          Trykk navnet for å redigere konfigurasjonen. Tørrtester (RSS,
          ekstraksjon) bor på redigeringssiden.
        </CardDescription>
      </CardHeader>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Navn</TableHead>
              <TableHead>Domene</TableHead>
              <TableHead>RSS</TableHead>
              <TableHead>Cursor</TableHead>
              <TableHead className="text-right">Kø (P / F)</TableHead>
              <TableHead>Sist pollet</TableHead>
              <TableHead>Aktiv</TableHead>
              <TableHead className="text-right">Backfill</TableHead>
              <TableHead className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((s) => {
              const q = queueBySource.get(s.id) ?? { pending: 0, failed: 0 };
              return (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/admin/media/sources/${s.id}`}
                      className="underline decoration-dotted underline-offset-4 hover:opacity-80"
                    >
                      {s.name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {s.domain}
                  </TableCell>
                  <TableCell>
                    {s.rss_url ? (
                      <Badge variant="outline" className="font-mono text-[0.65rem]">
                        ja
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {s.backfill_cursor ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span>{q.pending.toLocaleString("nb-NO")}</span>
                    <span className="text-muted-foreground"> / </span>
                    <span
                      className={
                        q.failed > 0 ? "text-rose-600 dark:text-rose-400" : ""
                      }
                    >
                      {q.failed.toLocaleString("nb-NO")}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {s.last_polled_at ? fmtDateTime(s.last_polled_at) : "aldri"}
                  </TableCell>
                  <TableCell>
                    <form action={toggleActiveAction.bind(null, s.id)}>
                      <input
                        type="hidden"
                        name="is_active"
                        value={String(!s.is_active)}
                      />
                      <SubmitButton
                        variant="outline"
                        size="sm"
                        pendingLabel={s.is_active ? "Av…" : "På…"}
                      >
                        <Power />
                        {s.is_active ? "Aktiv" : "Inaktiv"}
                      </SubmitButton>
                    </form>
                  </TableCell>
                  <TableCell className="text-right">
                    <form action={backfillSourceAction.bind(null, s.id)}>
                      <SubmitButton
                        variant="outline"
                        size="sm"
                        pendingLabel="Kjører…"
                        title="Tikk scrapegraph-backfill"
                      >
                        <Download />
                        Kjør
                      </SubmitButton>
                    </form>
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/admin/media/sources/${s.id}/edit`}
                      className="inline-flex items-center gap-1 text-xs font-medium hover:opacity-80"
                    >
                      Rediger
                      <ArrowRight className="size-3.5" />
                    </Link>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
