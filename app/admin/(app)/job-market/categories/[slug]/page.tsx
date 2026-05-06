import Link from "next/link";
import { ArrowLeft, History, Trash2 } from "lucide-react";

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
import { fmtDateTime } from "@/lib/admin/flash";
import { sbFetch } from "@/lib/admin/sb";
import { retireAction, updateAction } from "../actions";

export const dynamic = "force-dynamic";

type Category = {
  slug: string;
  title: string;
  definition_md: string;
  sort_order: number;
  retired_at: string | null;
  created_at: string;
  updated_at: string;
};

type CountRow = { count: number };

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function unwrapCount(rows: CountRow[] | { count: number }): number {
  if (Array.isArray(rows)) return rows[0]?.count ?? 0;
  return rows.count ?? 0;
}

export default async function CategoryEditPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;

  const [rows, postingCountRows] = await Promise.all([
    sbFetch<Category[]>(
      `/taxonomy_categories?slug=eq.${encodeURIComponent(slug)}` +
        `&select=slug,title,definition_md,sort_order,retired_at,created_at,updated_at`,
      { service: true },
    ).catch(() => [] as Category[]),
    sbFetch<CountRow[] | { count: number }>(
      `/nav_postings?llm_categories=cs.${encodeURIComponent(JSON.stringify({ categories: [{ slug }] }))}&select=count`,
      { service: true, headers: { Prefer: "count=exact" } },
    ).catch(() => [] as CountRow[]),
  ]);
  const cat = rows[0];
  const postingCount = unwrapCount(postingCountRows);

  if (!cat) {
    return (
      <>
        <Flash searchParams={sp} />
        <PageHeader
          eyebrow="Taksonomi"
          title="Endre kategori"
          action={
            <Button asChild variant="outline">
              <Link href="/admin/job-market/categories">
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

  const update = updateAction.bind(null, cat.slug);
  const retire = retireAction.bind(null, cat.slug);
  const isRetired = cat.retired_at != null;

  return (
    <>
      <Flash searchParams={sp} />
      <PageHeader
        eyebrow="Taksonomi"
        title={cat.title}
        description={
          <>
            Slug{" "}
            <code className="font-mono">{cat.slug}</code> er uforanderlig — den
            referes fra{" "}
            <code className="font-mono">nav_postings.llm_categories</code>.{" "}
            Markdown i definisjonen rendres på{" "}
            <code className="font-mono">/metode</code>.
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
            Rediger kategori
          </CardTitle>
          <CardDescription>
            Endringer bumper taksonomi-versjonen. Bruk &quot;Re-klassifiser&quot;
            på listesiden hvis definisjonen endres slik at gamle stillinger må
            klassifiseres på nytt.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={update}
            className="flex flex-col gap-4"
            aria-label={`Rediger ${cat.slug}`}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="slug-display">Slug (uforanderlig)</Label>
              <Input
                id="slug-display"
                value={cat.slug}
                disabled
                className="font-mono"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="title">Tittel</Label>
              <Input
                id="title"
                name="title"
                required
                maxLength={200}
                defaultValue={cat.title}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="definition_md">Definisjon (markdown)</Label>
              <Textarea
                id="definition_md"
                name="definition_md"
                rows={12}
                defaultValue={cat.definition_md}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Brukes både i Tier 2-prompten (LLM-en leser definisjonen for å
                klassifisere stillinger) og rendres på den offentlige{" "}
                <code className="font-mono">/metode</code>-siden.
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
                defaultValue={cat.sort_order}
              />
              <p className="text-xs text-muted-foreground">
                Lavere tall først. La det være hopp på 10 mellom kategoriene
                for å gjøre fremtidige innskudd enkle.
              </p>
            </div>

            <div className="flex gap-2">
              <SubmitButton pendingLabel="Lagrer…">Lagre</SubmitButton>
            </div>
          </form>
        </CardContent>
      </Card>

      {!isRetired ? (
        <Card className="mt-6 border-amber-500/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em]">
              <Trash2 className="size-3.5" />
              Pensjonér
            </CardTitle>
            <CardDescription>
              Mykt slett — slug-en lever videre i{" "}
              <code className="font-mono">nav_postings.llm_categories</code>{" "}
              som audit, men kategorien forsvinner fra Tier 2-prompten og{" "}
              <code className="font-mono">/metode</code>. Kan ikke angres via
              UI-en (slug-en kan aldri gjenbrukes).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={retire}>
              <SubmitButton variant="destructive" pendingLabel="Pensjonerer…">
                <Trash2 />
                Pensjonér &quot;{cat.title}&quot;
              </SubmitButton>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card className="mt-6 border-muted">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em]">
              <History className="size-3.5" />
              Pensjonert{" "}
              {cat.retired_at ? fmtDateTime(cat.retired_at) : "tidligere"}
            </CardTitle>
            <CardDescription>
              Skjult fra Tier 2 og <code className="font-mono">/metode</code>.
              {postingCount > 0
                ? ` ${postingCount.toLocaleString("nb-NO")} stilling${postingCount === 1 ? "" : "er"} er fortsatt merket med denne slug-en (audit).`
                : ""}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        Opprettet {fmtDateTime(cat.created_at)} · sist endret{" "}
        {fmtDateTime(cat.updated_at)} ·{" "}
        {postingCount.toLocaleString("nb-NO")} stilling
        {postingCount === 1 ? "" : "er"} klassifisert
      </p>
    </>
  );
}
