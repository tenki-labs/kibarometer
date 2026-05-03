import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Flash } from "@/app/admin/_components/flash";
import { PageHeader } from "@/app/admin/_components/page-header";
import { SubmitButton } from "@/app/admin/_components/submit-button";
import { sbFetch } from "@/lib/admin/sb";
import { fmtDateTime } from "@/lib/admin/flash";
import { updateAction } from "../actions";

type ContentRow = {
  slug: string;
  title: string;
  body_md: string;
  updated_at: string;
};

const PUBLIC_PATH: Record<string, string> = {
  om: "/om",
  metode: "/metode",
};

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ContentEditPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;

  const rows = await sbFetch<ContentRow[]>(
    `/site_content?slug=eq.${encodeURIComponent(slug)}&select=slug,title,body_md,updated_at`,
    { service: true },
  );
  const row = rows[0];

  if (!row) {
    return (
      <>
        <Flash searchParams={sp} />
        <PageHeader
          eyebrow="Innsikt"
          title="Endre innhold"
          action={
            <Button asChild variant="outline">
              <Link href="/admin/content">
                <ArrowLeft />
                Tilbake
              </Link>
            </Button>
          }
        />
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Ikke funnet.
          </CardContent>
        </Card>
      </>
    );
  }

  const update = updateAction.bind(null, row.slug);
  const livePath = PUBLIC_PATH[row.slug] ?? `/${row.slug}`;

  return (
    <>
      <Flash searchParams={sp} />
      <PageHeader
        eyebrow="Innsikt"
        title={row.title}
        description={
          <>
            Markdown — overskrifter <code className="font-mono">## h2</code>,
            lenker <code className="font-mono">[text](url)</code>, fet{" "}
            <code className="font-mono">**…**</code>, kursiv{" "}
            <code className="font-mono">*…*</code>, kode{" "}
            <code className="font-mono">`…`</code>, lister{" "}
            <code className="font-mono">- …</code>.
          </>
        }
        action={
          <Button asChild variant="ghost">
            <Link href="/admin/content">
              <ArrowLeft />
              Tilbake
            </Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="font-mono text-xs uppercase tracking-[0.18em]">
            Rediger innhold
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            action={update}
            className="flex flex-col gap-4"
            aria-label={`Rediger ${row.slug}`}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="title">Tittel</Label>
              <Input
                id="title"
                name="title"
                required
                defaultValue={row.title}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="body_md">Brødtekst (markdown)</Label>
              <Textarea
                id="body_md"
                name="body_md"
                rows={24}
                required
                defaultValue={row.body_md}
                className="font-mono text-sm"
              />
            </div>
            <div className="flex gap-2">
              <SubmitButton pendingLabel="Lagrer…">Lagre</SubmitButton>
              <Button asChild variant="ghost">
                <a href={livePath} target="_blank" rel="noreferrer">
                  Forhåndsvis live
                </a>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <p className="mt-4 text-xs text-muted-foreground">
        Sist endret {fmtDateTime(row.updated_at)} ·{" "}
        <code className="font-mono">{row.slug}</code> · live-URL{" "}
        <code className="font-mono">{livePath}</code>
      </p>
    </>
  );
}
