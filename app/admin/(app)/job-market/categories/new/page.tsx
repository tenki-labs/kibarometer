import Link from "next/link";
import { ArrowLeft } from "lucide-react";

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
import { Textarea } from "@/components/ui/textarea";
import { Flash } from "@/app/admin/_components/flash";
import { PageHeader } from "@/app/admin/_components/page-header";
import { SubmitButton } from "@/app/admin/_components/submit-button";
import { sbFetch } from "@/lib/admin/sb";
import { createAction } from "../actions";

export const dynamic = "force-dynamic";

type Category = { sort_order: number };

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Default the new sort_order to (max + 10) so fresh categories sit at the end
// of the list. Keeps the operator from having to reason about ordering on
// first creation.
async function nextSortOrder(): Promise<number> {
  const rows = await sbFetch<Category[]>(
    `/taxonomy_categories?select=sort_order&order=sort_order.desc&limit=1`,
    { service: true },
  ).catch(() => [] as Category[]);
  const max = rows[0]?.sort_order ?? 0;
  return max + 10;
}

export default async function CategoryNewPage({ searchParams }: Props) {
  const sp = await searchParams;
  const defaultSortOrder = await nextSortOrder();

  return (
    <>
      <Flash searchParams={sp} />
      <PageHeader
        eyebrow="Taksonomi"
        title="Ny kategori"
        description={
          <>
            Slug-en blir uforanderlig etter lagring og referes fra{" "}
            <code className="font-mono">nav_postings.llm_categories</code>.
            Velg den med omhu — kebab-case, små bokstaver, ingen mellomrom.
          </>
        }
        action={
          <Button asChild variant="ghost">
            <Link href="/admin/job-market/categories">
              <ArrowLeft />
              Tilbake
            </Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="font-mono text-xs uppercase tracking-[0.18em]">
            Opprett kategori
          </CardTitle>
          <CardDescription>
            Bumper taksonomi-versjonen. Den nye kategorien blir umiddelbart
            tilgjengelig for Tier 2-klassifisering på neste cron-tikk.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createAction} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="slug">Slug</Label>
              <Input
                id="slug"
                name="slug"
                required
                pattern="^[a-z0-9]+(-[a-z0-9]+)*$"
                minLength={2}
                maxLength={64}
                placeholder="f.eks. ml-data-science"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Små bokstaver, tall og bindestreker (ingen ledende/etterstilte
                bindestreker, ingen doble bindestreker). 2–64 tegn.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="title">Tittel</Label>
              <Input
                id="title"
                name="title"
                required
                maxLength={200}
                placeholder="f.eks. ML / Data science"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="definition_md">Definisjon (markdown)</Label>
              <Textarea
                id="definition_md"
                name="definition_md"
                rows={10}
                placeholder="Stillinger som …"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Brukes i Tier 2-prompten og rendres på{" "}
                <code className="font-mono">/docs/nokkelord</code>.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:max-w-xs">
              <Label htmlFor="sort_order">Sortering</Label>
              <Input
                id="sort_order"
                name="sort_order"
                type="number"
                step="10"
                min={-10000}
                max={10000}
                defaultValue={defaultSortOrder}
              />
              <p className="text-xs text-muted-foreground">
                Lavere tall først. Forslaget legger den nye kategorien sist.
              </p>
            </div>

            <div className="flex gap-2">
              <SubmitButton pendingLabel="Oppretter…">Opprett</SubmitButton>
              <Button asChild variant="ghost">
                <Link href="/admin/job-market/categories">Avbryt</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
