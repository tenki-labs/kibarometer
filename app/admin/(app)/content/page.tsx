import Link from "next/link";
import { ArrowRight, FileText } from "lucide-react";

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
import { fmtDateTime } from "@/lib/admin/flash";

type ContentRow = {
  slug: string;
  title: string;
  updated_at: string;
};

const PUBLIC_PATH: Record<string, string> = {
  om: "/om",
  metode: "/metode",
};

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ContentListPage({ searchParams }: Props) {
  const params = await searchParams;

  const rows = await sbFetch<ContentRow[]>(
    "/site_content?select=slug,title,updated_at&order=slug.asc",
    { service: true },
  ).catch(() => [] as ContentRow[]);

  return (
    <>
      <Flash searchParams={params} />
      <PageHeader
        eyebrow="Innsikt"
        title="Innhold"
        description="Rediger statisk markdown-tekst på de offentlige sidene uten å re-deploye. Live nøkkelordliste på /metode bygges fra nøkkelord-tabellen og er ikke editerbar her."
      />

      <Card className="gap-0 p-0">
        <CardHeader className="px-6 py-4">
          <CardTitle className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.14em]">
            <FileText className="size-4" />
            Editerbare sider
          </CardTitle>
          <CardDescription className="mt-1">
            Endringer publiseres innen 60 sekunder (ISR-cache).
          </CardDescription>
        </CardHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Slug</TableHead>
                <TableHead>Tittel</TableHead>
                <TableHead>Live-URL</TableHead>
                <TableHead>Sist endret</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-12 text-center text-muted-foreground"
                  >
                    Ingen rader — er migrasjon 0011 kjørt?
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => {
                  const livePath = PUBLIC_PATH[r.slug] ?? `/${r.slug}`;
                  return (
                    <TableRow key={r.slug}>
                      <TableCell className="font-mono text-xs">
                        {r.slug}
                      </TableCell>
                      <TableCell>{r.title}</TableCell>
                      <TableCell>
                        <a
                          href={livePath}
                          className="font-mono text-xs text-muted-foreground underline decoration-dotted hover:text-foreground"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {livePath}
                        </a>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDateTime(r.updated_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={`/admin/content/${r.slug}`}
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
