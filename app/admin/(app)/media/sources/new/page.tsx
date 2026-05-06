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
import { Flash } from "@/app/admin/_components/flash";
import { PageHeader } from "@/app/admin/_components/page-header";
import { SubmitButton } from "@/app/admin/_components/submit-button";
import { createAction } from "../actions";
import { SourceFields } from "../_form";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function NewSourcePage({ searchParams }: Props) {
  const sp = await searchParams;
  return (
    <>
      <Flash searchParams={sp} />
      <PageHeader
        eyebrow="Mediedekning"
        title="Ny kilde"
        description="Opprett en outlet med RSS, search_config og rate-limit. Lagre først, tørrtest deretter på redigeringssiden før du aktiverer."
        action={
          <Button asChild variant="ghost">
            <Link href="/admin/media/sources">
              <ArrowLeft />
              Tilbake
            </Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="font-mono text-xs uppercase tracking-[0.18em]">
            Konfigurasjon
          </CardTitle>
          <CardDescription>
            JSON-feltene parses ved lagring; ugyldig JSON gir feilmelding og
            ingen rad opprettes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createAction} className="flex flex-col gap-6">
            <SourceFields />
            <div className="flex gap-2">
              <SubmitButton pendingLabel="Oppretter…">Opprett</SubmitButton>
              <Button asChild variant="ghost">
                <Link href="/admin/media/sources">Avbryt</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
