import Link from "next/link";
import { ArrowRight, Database } from "lucide-react";

import {
  Card,
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
import { sbFetch } from "@/lib/admin/sb";

type ListedTable = {
  table_name: string;
  row_estimate: number;
};

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DataIndexPage({ searchParams }: Props) {
  const params = await searchParams;

  const tables = await sbFetch<ListedTable[]>("/rpc/admin_list_tables", {
    service: true,
    method: "POST",
    body: {},
  }).catch(() => [] as ListedTable[]);

  return (
    <>
      <Flash searchParams={params} />
      <PageHeader
        eyebrow="Innsikt"
        title="Data"
        description="Skrivebeskyttet inspeksjon av Postgres-tabeller. Hopper over alt utenfor public-skjemaet og maskerer åpenbart sensitive tabellnavn (token, secret, password)."
      />

      <Card className="gap-0 p-0">
        <CardHeader className="px-6 py-4">
          <CardTitle className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.14em]">
            <Database className="size-4" />
            public.* — {tables.length} tabeller
          </CardTitle>
          <CardDescription className="mt-1">
            Klikk for å vise rader (paginerte 100 av gangen).
          </CardDescription>
        </CardHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tabell</TableHead>
                <TableHead className="text-right">Rader (estimat)</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tables.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={3}
                    className="py-12 text-center text-muted-foreground"
                  >
                    Ingen tabeller — er migrasjon 0010 kjørt?
                  </TableCell>
                </TableRow>
              ) : (
                tables.map((t) => (
                  <TableRow key={t.table_name}>
                    <TableCell className="font-mono text-xs">
                      {t.table_name}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {t.row_estimate.toLocaleString("nb-NO")}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/admin/database/${encodeURIComponent(t.table_name)}`}
                        className="inline-flex items-center gap-1 text-xs font-medium hover:opacity-80"
                      >
                        Vis
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
    </>
  );
}
