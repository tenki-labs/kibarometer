import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Flash } from "@/app/admin/_components/flash";
import { PageHeader } from "@/app/admin/_components/page-header";
import { SubmitButton } from "@/app/admin/_components/submit-button";
import { sbFetch } from "@/lib/admin/sb";
import { CategoryFields } from "../_form";
import { createAction } from "../actions";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function NewMediaCategoryPage({ searchParams }: Props) {
  const sp = await searchParams;

  const parents = await sbFetch<{ slug: string; label_no: string }[]>(
    `/media_categories?is_active=is.true&select=slug,label_no&order=slug.asc`,
    { service: true },
  ).catch(() => []);

  return (
    <>
      <Flash searchParams={sp} />
      <PageHeader
        eyebrow="Mediedekning · Kategorier"
        title="Ny kategori"
        action={
          <Button asChild variant="outline">
            <Link href="/admin/media/categories">
              <ArrowLeft />
              Tilbake
            </Link>
          </Button>
        }
      />

      <Card className="mt-6">
        <CardContent className="pt-6">
          <form action={createAction} className="space-y-6">
            <CategoryFields parents={parents} lockSlug={false} />
            <div className="flex justify-end">
              <SubmitButton pendingLabel="Oppretter…">Opprett</SubmitButton>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
