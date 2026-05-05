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
import { fmtDateTime } from "@/lib/admin/flash";
import { sbFetch } from "@/lib/admin/sb";
import { backfillSourceAction, toggleActiveAction } from "./actions";

export const dynamic = "force-dynamic";

type Source = {
  id: string;
  name: string;
  domain: string;
  rss_url: string | null;
  backfill_method: string;
  search_config: unknown | null;
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

export default async function MediaSourcesPage({ searchParams }: Props) {
  const sp = await searchParams;

  const [sources, queueRows] = await Promise.all([
    sbFetch<Source[]>(
      `/media_sources?select=id,name,domain,rss_url,backfill_method,search_config,crawl_delay_ms,is_active,last_polled_at,backfill_cursor,notes` +
        `&order=is_active.desc,name.asc`,
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

  return (
    <>
      <Flash searchParams={sp} />
      <PageHeader
        eyebrow="Mediedekning"
        title="Kilder"
        description="Norske medieoutletter pipelinen poller. Aktiver én etter at search_config er sjekket via tørrtest."
        action={
          <Button asChild>
            <Link href="/admin/media/sources/new">
              <Plus />
              Ny kilde
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Aktive kilder"
          value={active.length}
          hint={`${inactive.length} inaktive`}
        />
        <StatCard
          label="Med RSS"
          value={sources.filter((s) => s.rss_url).length}
          hint="Daglig discover-cron poller disse"
        />
        <StatCard
          label="Med search_config"
          value={sources.filter((s) => s.search_config).length}
          hint="Klar for backfill"
        />
      </div>

      <Card className="mt-6 gap-0 p-0">
        <CardHeader className="px-6 py-4">
          <CardTitle className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.14em]">
            <Rss className="size-4" />
            Alle kilder
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
                <TableHead>Backfill</TableHead>
                <TableHead className="text-right">Kø (P / F)</TableHead>
                <TableHead>Sist pollet</TableHead>
                <TableHead>Aktiv</TableHead>
                <TableHead className="text-right">Backfill</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sources.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="py-12 text-center text-muted-foreground"
                  >
                    Ingen kilder ennå.
                  </TableCell>
                </TableRow>
              ) : (
                sources.map((s) => {
                  const q = queueBySource.get(s.id) ?? { pending: 0, failed: 0 };
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/admin/media/sources/${s.id}/edit`}
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
                        {s.backfill_method}
                        {s.backfill_cursor ? ` · ${s.backfill_cursor}` : ""}
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
                            disabled={
                              !s.search_config &&
                              s.backfill_method !== "sitemap"
                            }
                            title={
                              !s.search_config &&
                              s.backfill_method !== "sitemap"
                                ? "Sett search_config eller bytt til sitemap først"
                                : `Tikk backfill (${s.backfill_method})`
                            }
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
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </>
  );
}
