import Link from "next/link";
import {
  ArrowRight,
  FolderTree,
  History,
  ListChecks,
  Plus,
  TimerReset,
} from "lucide-react";

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
import { StatCard } from "@/app/admin/_components/stat-card";
import { SubmitButton } from "@/app/admin/_components/submit-button";
import { fmtDateTime } from "@/lib/admin/flash";
import { sbFetch } from "@/lib/admin/sb";
import { reprocessAction, reprocessCategoryAction } from "./actions";

export const dynamic = "force-dynamic";

type Category = {
  slug: string;
  title: string;
  definition_md: string;
  sort_order: number;
  retired_at: string | null;
  created_at: string;
  updated_at: string;
};

type CountRow = { count: number };
type VersionRow = { version: number; created_at: string; notes: string | null };

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function unwrapCount(rows: CountRow[] | { count: number }): number {
  if (Array.isArray(rows)) return rows[0]?.count ?? 0;
  return rows.count ?? 0;
}

async function countCategoryPostings(slug: string): Promise<number> {
  const cs = JSON.stringify({ categories: [{ slug }] });
  const rows = await sbFetch<CountRow[] | { count: number }>(
    `/nav_postings?llm_categories=cs.${encodeURIComponent(cs)}&select=count`,
    { service: true, headers: { Prefer: "count=exact" } },
  ).catch(() => [] as CountRow[]);
  return unwrapCount(rows);
}

function estimateMinutes(count: number): number {
  if (count <= 0) return 0;
  return Math.max(1, Math.ceil((count * 12) / 60));
}

export default async function CategoriesPage({ searchParams }: Props) {
  const sp = await searchParams;

  const [live, retired, totalAi, versionRows] = await Promise.all([
    sbFetch<Category[]>(
      `/taxonomy_categories?retired_at=is.null` +
        `&select=slug,title,definition_md,sort_order,retired_at,created_at,updated_at` +
        `&order=sort_order.asc,slug.asc`,
      { service: true },
    ).catch(() => [] as Category[]),
    sbFetch<Category[]>(
      `/taxonomy_categories?retired_at=not.is.null` +
        `&select=slug,title,definition_md,sort_order,retired_at,created_at,updated_at` +
        `&order=retired_at.desc&limit=50`,
      { service: true },
    ).catch(() => [] as Category[]),
    sbFetch<CountRow[] | { count: number }>(
      `/nav_postings?is_ai=is.true&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => [] as CountRow[]),
    sbFetch<VersionRow[]>(
      `/taxonomy_versions?select=version,created_at,notes&order=version.desc&limit=10`,
      { service: true },
    ).catch(() => [] as VersionRow[]),
  ]);

  const counts = await Promise.all(
    live.map((cat) => countCategoryPostings(cat.slug)),
  );
  const liveByCount: Array<Category & { posting_count: number }> = live.map(
    (cat, i) => ({ ...cat, posting_count: counts[i] ?? 0 }),
  );
  const totalAiCount = unwrapCount(totalAi);
  const latestVersion = versionRows[0] ?? null;

  return (
    <>
      <Flash searchParams={sp} />
      <PageHeader
        eyebrow="Taksonomi"
        title="Kategorier"
        description="AI-skill-kategorier som driver Tier 2-klassifiseringen og /metode-siden. Slug er uforanderlig — opprett ny og pensjonér gammel for å skifte navn."
        action={
          <Button asChild>
            <Link href="/admin/categories/new">
              <Plus />
              Ny kategori
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Aktive kategorier"
          value={live.length}
          hint={`${retired.length} pensjonert`}
        />
        <StatCard
          label="AI-stillinger totalt"
          value={totalAiCount.toLocaleString("nb-NO")}
          hint="is_ai=true (klassifiserbare)"
        />
        <StatCard
          label="Taksonomi-versjon"
          value={latestVersion ? `v${latestVersion.version}` : "—"}
          hint={
            latestVersion
              ? `${fmtDateTime(latestVersion.created_at)} · ${latestVersion.notes ?? ""}`
              : "Ingen versjoner registrert"
          }
        />
      </div>

      <Card className="mt-6 gap-0 p-0">
        <CardHeader className="px-6 py-4">
          <CardTitle className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.14em]">
            <FolderTree className="size-4" />
            Aktive kategorier
          </CardTitle>
          <CardDescription className="mt-1">
            Sortert etter <code className="font-mono">sort_order</code>. Tallet
            er antall stillinger som er klassifisert med kategorien (alle
            tider). Re-klassifiser én rad når du har endret definisjonen.
          </CardDescription>
        </CardHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tittel</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead className="text-right">Sortering</TableHead>
                <TableHead className="text-right">Stillinger</TableHead>
                <TableHead className="text-right" />
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {liveByCount.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-12 text-center text-muted-foreground"
                  >
                    Ingen aktive kategorier. Tier 2-klassifisering hopper over
                    til minst én er opprettet.
                  </TableCell>
                </TableRow>
              ) : (
                liveByCount.map((cat) => (
                  <TableRow key={cat.slug}>
                    <TableCell className="font-medium">{cat.title}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {cat.slug}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {cat.sort_order}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {cat.posting_count.toLocaleString("nb-NO")}
                    </TableCell>
                    <TableCell className="text-right">
                      <form
                        action={reprocessCategoryAction.bind(null, cat.slug)}
                      >
                        <SubmitButton
                          variant="outline"
                          size="sm"
                          pendingLabel="Køer…"
                          disabled={cat.posting_count === 0}
                          title={
                            cat.posting_count === 0
                              ? "Ingen stillinger å re-klassifisere"
                              : `~${estimateMinutes(cat.posting_count)} min på Mac-en`
                          }
                        >
                          <TimerReset />
                          Re-klassifiser
                        </SubmitButton>
                      </form>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/admin/categories/${cat.slug}`}
                        className="inline-flex items-center gap-1 text-xs font-medium hover:opacity-80"
                      >
                        Rediger
                        <ArrowRight className="size-3.5" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em]">
            <ListChecks className="size-3.5" />
            Bulk re-klassifisering
          </CardTitle>
          <CardDescription>
            Tøm Tier 2-resultater for et utvalg stillinger så cron-jobben
            klassifiserer dem på nytt med gjeldende prompt og taksonomi.
            Forhåndsvis først for å se omfanget. Estimat: ~12 s per stilling.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={reprocessAction}
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="scope">Omfang</Label>
              <Select name="scope" defaultValue="all_ai">
                <SelectTrigger id="scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all_ai">Alle AI-stillinger</SelectItem>
                  <SelectItem value="category">Bare én kategori</SelectItem>
                  <SelectItem value="since_date">Postet etter dato</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="category_slug">
                Kategori{" "}
                <span className="text-muted-foreground">(ved &quot;Bare én kategori&quot;)</span>
              </Label>
              <Select name="category_slug" defaultValue="">
                <SelectTrigger id="category_slug">
                  <SelectValue placeholder="Velg kategori" />
                </SelectTrigger>
                <SelectContent>
                  {live.length === 0 ? (
                    <SelectItem value="__none" disabled>
                      Ingen aktive kategorier
                    </SelectItem>
                  ) : (
                    live.map((cat) => (
                      <SelectItem key={cat.slug} value={cat.slug}>
                        {cat.title} ({cat.slug})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="since_date">
                Fra dato{" "}
                <span className="text-muted-foreground">(ved &quot;Postet etter dato&quot;)</span>
              </Label>
              <Input
                id="since_date"
                name="since_date"
                type="date"
                placeholder="YYYY-MM-DD"
              />
            </div>

            <div className="flex items-end gap-2">
              <SubmitButton
                name="intent"
                value="preview"
                variant="outline"
                pendingLabel="Beregner…"
              >
                Forhåndsvis
              </SubmitButton>
              <SubmitButton
                name="intent"
                value="run"
                pendingLabel="Køer…"
              >
                <TimerReset />
                Kjør
              </SubmitButton>
            </div>
          </form>
          <p className="mt-3 text-xs text-muted-foreground">
            Bulk-handlingen tilbakestiller{" "}
            <code className="font-mono">tier2_completed_at</code> og{" "}
            <code className="font-mono">llm_retry_count</code> på matchende
            rader. Den faktiske LLM-klassifiseringen skjer på neste Tier
            2-kjøring (cron hvert 15. min).
          </p>
        </CardContent>
      </Card>

      {retired.length > 0 ? (
        <Card className="mt-6 gap-0 p-0">
          <CardHeader className="px-6 py-4">
            <details>
              <summary className="cursor-pointer list-none">
                <CardTitle className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.14em]">
                  <History className="size-4" />
                  Pensjonerte kategorier ({retired.length})
                </CardTitle>
                <CardDescription className="mt-1">
                  Slug-en lever videre i{" "}
                  <code className="font-mono">nav_postings.llm_categories</code>{" "}
                  som audit. Skjult fra Tier 2-prompten og /metode-siden.
                </CardDescription>
              </summary>
              <div className="mt-4 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tittel</TableHead>
                      <TableHead>Slug</TableHead>
                      <TableHead>Pensjonert</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {retired.map((cat) => (
                      <TableRow key={cat.slug}>
                        <TableCell>{cat.title}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {cat.slug}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {cat.retired_at ? fmtDateTime(cat.retired_at) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </details>
          </CardHeader>
        </Card>
      ) : null}

      {versionRows.length > 0 ? (
        <Card className="mt-6 gap-0 p-0">
          <CardHeader className="px-6 py-4">
            <details>
              <summary className="cursor-pointer list-none">
                <CardTitle className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.14em]">
                  <History className="size-4" />
                  Taksonomi-versjoner (siste 10)
                </CardTitle>
                <CardDescription className="mt-1">
                  Hver opprettelse, redigering eller pensjonering bumper
                  versjonen. Stillinger lagrer{" "}
                  <code className="font-mono">llm_taxonomy_version</code> så vi
                  vet hvilken versjon klassifiserte dem.
                </CardDescription>
              </summary>
              <div className="mt-4 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">Versjon</TableHead>
                      <TableHead>Notater</TableHead>
                      <TableHead>Tidspunkt</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {versionRows.map((v) => (
                      <TableRow key={v.version}>
                        <TableCell className="text-right tabular-nums">
                          <Badge variant="outline" className="font-mono">
                            v{v.version}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {v.notes ?? "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {fmtDateTime(v.created_at)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </details>
          </CardHeader>
        </Card>
      ) : null}
    </>
  );
}
