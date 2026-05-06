import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Flash } from "@/app/admin/_components/flash";
import { PageHeader } from "@/app/admin/_components/page-header";
import { SubmitButton } from "@/app/admin/_components/submit-button";
import { BrregCategoryFields } from "../_form";
import { createAction } from "../actions";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function NewBrregCategoryPage({ searchParams }: Props) {
  const sp = await searchParams;

  return (
    <>
      <Flash searchParams={sp} />
      <PageHeader
        eyebrow="Oppstart · Kategorier"
        title="Ny AI-kategori"
        action={
          <Button asChild variant="outline">
            <Link href="/admin/startups/categories">
              <ArrowLeft />
              Tilbake
            </Link>
          </Button>
        }
      />

      <Card className="mt-6">
        <CardContent className="pt-6">
          <form action={createAction} className="space-y-6">
            <BrregCategoryFields lockSlug={false} />
            <div className="flex justify-end">
              <SubmitButton pendingLabel="Oppretter…">Opprett</SubmitButton>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
