import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Flash } from "@/app/admin/_components/flash";
import { PageHeader } from "@/app/admin/_components/page-header";
import { SubmitButton } from "@/app/admin/_components/submit-button";
import { sbFetch } from "@/lib/admin/sb";
import { CategoryFields } from "../../_form";
import { updateAction } from "../../actions";

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
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function EditMediaCategoryPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;

  const [rows, parents] = await Promise.all([
    sbFetch<Category[]>(
      `/media_categories?slug=eq.${encodeURIComponent(slug)}` +
        `&select=slug,label_no,label_en,parent_slug,description,is_active`,
      { service: true },
    ).catch(() => [] as Category[]),
    sbFetch<{ slug: string; label_no: string }[]>(
      `/media_categories?is_active=is.true&select=slug,label_no&order=slug.asc`,
      { service: true },
    ).catch(() => []),
  ]);

  const cat = rows[0];
  if (!cat) notFound();

  return (
    <>
      <Flash searchParams={sp} />
      <PageHeader
        eyebrow="Mediedekning · Kategorier"
        title={cat.label_no}
        description={`slug: ${cat.slug}`}
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
          <form action={updateAction.bind(null, cat.slug)} className="space-y-6">
            <CategoryFields parents={parents} lockSlug initial={cat} />
            <div className="flex justify-end">
              <SubmitButton pendingLabel="Lagrer…">Lagre</SubmitButton>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
