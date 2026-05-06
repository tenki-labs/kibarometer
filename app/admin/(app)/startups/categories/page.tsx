import Link from "next/link";
import { FolderTree, Plus, Power } from "lucide-react";

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Flash } from "@/app/admin/_components/flash";
import { PageHeader } from "@/app/admin/_components/page-header";
import { SubmitButton } from "@/app/admin/_components/submit-button";
import { sbFetch } from "@/lib/admin/sb";
import { toggleActiveAction } from "./actions";

export const dynamic = "force-dynamic";

type NaceRow = {
  slug: string;
  taxonomy_version: string;
  label_no: string;
  label_en: string | null;
  code_prefixes: string[];
  enrich_roles: boolean;
  sort_order: number;
  is_active: boolean;
};

type AiCategory = {
  slug: string;
  label_no: string;
  label_en: string | null;
  description: string | null;
  sort_order: number;
  is_active: boolean;
};

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CategoriesPage({ searchParams }: Props) {
  const params = await searchParams;
  const [naceRows, aiRows] = await Promise.all([
    sbFetch<NaceRow[]>(
      "/nace_categories?select=*&order=taxonomy_version.asc,sort_order.asc",
      { service: true },
    ).catch(() => [] as NaceRow[]),
    sbFetch<AiCategory[]>(
      "/brreg_categories?select=slug,label_no,label_en,description,sort_order,is_active" +
        "&order=is_active.desc,sort_order.asc,slug.asc",
      { service: true },
    ).catch(() => [] as AiCategory[]),
  ]);

  const sn2007 = naceRows.filter((r) => r.taxonomy_version === "sn2007");
  const sn2025 = naceRows.filter((r) => r.taxonomy_version === "sn2025-09");
  const aiActive = aiRows.filter((r) => r.is_active).length;

  return (
    <>
      <Flash searchParams={params} />
      <PageHeader
        eyebrow="Innsikt · Oppstart"
        title="Kategorier"
        description={
          <>
            To uavhengige taksonomier for brreg-pipelinen.{" "}
            <strong>NACE</strong> er en fast strukturell collapsing av
            næringskoder (read-only).{" "}
            <strong>AI-kategorier</strong> er den semantiske AI-startup-
            taksonomien som Tier 2-prompten substituerer i{" "}
            <code className="font-mono">{`{{categories_block}}`}</code> —
            redigerbar her.
          </>
        }
      />

      <Tabs defaultValue="ai" className="mt-6">
        <TabsList>
          <TabsTrigger value="ai">
            AI-kategorier ({aiActive}/{aiRows.length})
          </TabsTrigger>
          <TabsTrigger value="nace">
            NACE ({naceRows.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ai" className="mt-4">
          <Card className="gap-0 p-0">
            <CardHeader className="px-6 py-4">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.14em]">
                  <FolderTree className="size-4" />
                  {aiActive} aktive · {aiRows.length - aiActive} inaktive
                </CardTitle>
                <Button asChild size="sm">
                  <Link href="/admin/startups/categories/new">
                    <Plus />
                    Ny kategori
                  </Link>
                </Button>
              </div>
              <CardDescription className="mt-1">
                Slug er primærnøkkel og kan ikke endres etter opprettelse.
                Deaktivering er ikke-destruktivt — eksisterende klassifiseringer
                beholdes som audit, men slugen tilbys ikke til Tier 2 før den
                aktiveres igjen. Endringer slår inn på neste cron-tikk.
              </CardDescription>
            </CardHeader>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Slug</TableHead>
                    <TableHead>Etikett (NO)</TableHead>
                    <TableHead>Etikett (EN)</TableHead>
                    <TableHead>Beskrivelse</TableHead>
                    <TableHead className="text-right">Sort</TableHead>
                    <TableHead>Aktiv</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {aiRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                        Ingen AI-kategorier ennå. Trykk &quot;Ny kategori&quot; for å begynne — eller kjør migrasjon{" "}
                        <code className="font-mono">0038_brreg_categories.sql</code>{" "}
                        som seeder default-settet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    aiRows.map((c) => (
                      <TableRow key={c.slug}>
                        <TableCell className="font-mono text-xs">
                          <Link
                            href={`/admin/startups/categories/${c.slug}/edit`}
                            className="underline decoration-dotted underline-offset-4 hover:opacity-80"
                          >
                            {c.slug}
                          </Link>
                        </TableCell>
                        <TableCell className="font-medium">{c.label_no}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {c.label_en ?? "—"}
                        </TableCell>
                        <TableCell className="max-w-md truncate text-xs text-muted-foreground">
                          {c.description ?? "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {c.sort_order}
                        </TableCell>
                        <TableCell>
                          <form action={toggleActiveAction.bind(null, c.slug)}>
                            <input
                              type="hidden"
                              name="is_active"
                              value={String(!c.is_active)}
                            />
                            <SubmitButton
                              variant="outline"
                              size="sm"
                              pendingLabel={c.is_active ? "Av…" : "På…"}
                            >
                              <Power />
                              {c.is_active ? "Aktiv" : "Inaktiv"}
                            </SubmitButton>
                          </form>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="nace" className="mt-4">
          <p className="mb-4 text-xs text-muted-foreground">
            Kibarometer-grupperinger over Statistisk sentralbyrås
            næringskoder. Read-only i v1 — endringer gjøres direkte mot{" "}
            <code className="font-mono">public.nace_categories</code> via psql
            på VPS-en.
          </p>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">SN2007 ({sn2007.length})</CardTitle>
              <CardDescription>For foretak registrert før 2025-09-01.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <NaceTable rows={sn2007} />
            </CardContent>
          </Card>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-base">SN2025-09 ({sn2025.length})</CardTitle>
              <CardDescription>For foretak registrert fra og med 2025-09-01.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <NaceTable rows={sn2025} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}

function NaceTable({ rows }: { rows: NaceRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Slug</TableHead>
          <TableHead>Etikett (NO)</TableHead>
          <TableHead>Prefiks</TableHead>
          <TableHead className="text-right">Roller</TableHead>
          <TableHead className="text-right">Aktiv</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((c) => (
          <TableRow key={`${c.slug}:${c.taxonomy_version}`}>
            <TableCell className="font-mono text-xs">{c.slug}</TableCell>
            <TableCell className="text-sm">
              {c.label_no}
              {c.label_en && (
                <span className="ml-2 text-xs text-muted-foreground">
                  ({c.label_en})
                </span>
              )}
            </TableCell>
            <TableCell className="font-mono text-xs">
              {c.code_prefixes.length > 0 ? c.code_prefixes.join(", ") : "—"}
            </TableCell>
            <TableCell className="text-right">
              {c.enrich_roles ? <Badge variant="secondary">enrich</Badge> : "—"}
            </TableCell>
            <TableCell className="text-right text-xs">
              {c.is_active ? "ja" : "nei"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
