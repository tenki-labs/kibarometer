import Link from "next/link";

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
import { Badge } from "@/components/ui/badge";
import { Flash } from "@/app/admin/_components/flash";
import { PageHeader } from "@/app/admin/_components/page-header";
import { sbFetch } from "@/lib/admin/sb";

export const dynamic = "force-dynamic";

type CategoryRow = {
  slug: string;
  taxonomy_version: string;
  label_no: string;
  label_en: string | null;
  code_prefixes: string[];
  enrich_roles: boolean;
  sort_order: number;
  is_active: boolean;
};

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CategoriesPage({ searchParams }: Props) {
  const params = await searchParams;
  const rows = await sbFetch<CategoryRow[]>(
    "/nace_categories?select=*&order=taxonomy_version.asc,sort_order.asc",
    { service: true },
  ).catch(() => [] as CategoryRow[]);

  const sn2007 = rows.filter((r) => r.taxonomy_version === "sn2007");
  const sn2025 = rows.filter((r) => r.taxonomy_version === "sn2025-09");

  return (
    <>
      <Flash searchParams={params} />
      <PageHeader
        eyebrow="Innsikt · Oppstart"
        title="NACE-kategorier"
        description={
          <>
            Kibarometer-grupperinger over Statistisk sentralbyrås
            næringskoder. To taksonomi-versjoner: <strong>SN2007</strong>{" "}
            (registreringer før 2025-09-01) og{" "}
            <strong>SN2025-09</strong> (registreringer etter). Kategorier med{" "}
            <code className="text-xs">enrich_roles=true</code> får automatisk
            rolle-uthenting fra brreg's <em>roller</em>-endepunkt for
            grunderalder-beregning.
          </>
        }
      />

      <p className="mb-6 text-xs text-muted-foreground">
        Read-only i v1. Endringer kan gjøres direkte mot{" "}
        <code className="text-xs">public.nace_categories</code> via psql på VPS-en.
        En CRUD-side ligger på roadmap.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">SN2007 ({sn2007.length})</CardTitle>
          <CardDescription>For foretak registrert før 2025-09-01.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <CategoriesTable rows={sn2007} />
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">SN2025-09 ({sn2025.length})</CardTitle>
          <CardDescription>For foretak registrert fra og med 2025-09-01.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <CategoriesTable rows={sn2025} />
        </CardContent>
      </Card>

      <p className="mt-6 text-xs text-muted-foreground">
        <Link href="/admin/startups" className="underline underline-offset-2">
          ← Tilbake til oversikt
        </Link>
      </p>
    </>
  );
}

function CategoriesTable({ rows }: { rows: CategoryRow[] }) {
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
