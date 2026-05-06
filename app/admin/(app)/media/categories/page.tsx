import Link from "next/link";
import { ArrowLeft, FolderTree, Plus, Power } from "lucide-react";

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
import { SubmitButton } from "@/app/admin/_components/submit-button";
import { sbFetch } from "@/lib/admin/sb";
import { toggleActiveAction } from "./actions";

export const dynamic = "force-dynamic";

type Category = {
  slug: string;
  label_no: string;
  label_en: string | null;
  parent_slug: string | null;
  description: string | null;
  is_active: boolean;
};

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function MediaCategoriesPage({ searchParams }: Props) {
  const sp = await searchParams;

  const cats = await sbFetch<Category[]>(
    `/media_categories?select=slug,label_no,label_en,parent_slug,description,is_active&order=is_active.desc,slug.asc`,
    { service: true },
  ).catch(() => [] as Category[]);

  const active = cats.filter((c) => c.is_active).length;

  return (
    <>
      <Flash searchParams={sp} />
      <PageHeader
        eyebrow="Mediedekning"
        title="Kategorier"
        description="Tier 2-taksonomi for klassifisering av AI-saker. Endringer slår inn på neste cron-tikk — Tier 2-prompten henter slugs fra denne tabellen."
        action={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/admin/media">
                <ArrowLeft />
                Tilbake
              </Link>
            </Button>
            <Button asChild>
              <Link href="/admin/media/categories/new">
                <Plus />
                Ny kategori
              </Link>
            </Button>
          </div>
        }
      />

      <Card className="mt-6 gap-0 p-0">
        <CardHeader className="px-6 py-4">
          <CardTitle className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.14em]">
            <FolderTree className="size-4" />
            {active} aktive · {cats.length - active} inaktive
          </CardTitle>
          <CardDescription className="mt-1">
            Slug er primærnøkkel og kan ikke endres etter opprettelse.
            Deaktivering er ikke-destruktivt — eksisterende klassifiseringer
            beholdes som audit, men slugen tilbys ikke til Tier 2 før den
            aktiveres igjen.
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
                <TableHead>Aktiv</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {cats.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                    Ingen kategorier ennå. Trykk &quot;Ny kategori&quot; for å begynne.
                  </TableCell>
                </TableRow>
              ) : (
                cats.map((c) => (
                  <TableRow key={c.slug}>
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/admin/media/categories/${c.slug}/edit`}
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
                    <TableCell className="text-right">
                      <Badge variant="outline" className="font-mono text-[0.6rem]">
                        {c.parent_slug ?? "rot"}
                      </Badge>
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
