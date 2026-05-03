import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Flash } from "@/app/admin/_components/flash";
import { PageHeader } from "@/app/admin/_components/page-header";
import { SubmitButton } from "@/app/admin/_components/submit-button";
import { sbFetch } from "@/lib/admin/sb";
import { fmtDateTime } from "@/lib/admin/flash";
import { updateAction } from "../actions";

const SELECT_COLS =
  "id,term,language,category,match_type,is_active,notes,created_at,updated_at";

type Keyword = {
  id: string;
  term: string;
  language: "any" | "no" | "en";
  category: "tool" | "role" | "concept";
  match_type: "word" | "substring";
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function KeywordEditPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;

  const rows = await sbFetch<Keyword[]>(
    `/keywords?id=eq.${encodeURIComponent(id)}&select=${SELECT_COLS}`,
    { service: true },
  );
  const row = rows[0];

  if (!row) {
    return (
      <>
        <Flash searchParams={sp} />
        <PageHeader
          eyebrow="Taksonomi"
          title="Endre nøkkelord"
          action={
            <Button asChild variant="outline">
              <Link href="/admin/keywords">
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

  const update = updateAction.bind(null, row.id);

  return (
    <>
      <Flash searchParams={sp} />
      <PageHeader
        eyebrow="Taksonomi"
        title={row.term}
        description={`Endre term, språk, kategori, match-type eller notat. Bruk Re-tag-knappen på Nøkkelord-siden for å oppdatere eksisterende stillinger.`}
        action={
          <Button asChild variant="ghost">
            <Link href="/admin/keywords">
              <ArrowLeft />
              Tilbake
            </Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="font-mono text-xs uppercase tracking-[0.18em]">
            Endre nøkkelord
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            action={update}
            className="flex flex-col gap-4"
            aria-label={`Endre nøkkelord ${row.term}`}
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[2fr_1fr_1fr_1fr]">
              <div className="flex flex-col gap-2">
                <Label htmlFor="term">Term</Label>
                <Input id="term" name="term" required defaultValue={row.term} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="language">Språk</Label>
                <Select name="language" defaultValue={row.language}>
                  <SelectTrigger id="language">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">alle</SelectItem>
                    <SelectItem value="no">norsk</SelectItem>
                    <SelectItem value="en">engelsk</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="category">Kategori</Label>
                <Select name="category" defaultValue={row.category}>
                  <SelectTrigger id="category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tool">Verktøy</SelectItem>
                    <SelectItem value="role">Rolle / tittel</SelectItem>
                    <SelectItem value="concept">Begrep</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="match_type">Match</Label>
                <Select name="match_type" defaultValue={row.match_type}>
                  <SelectTrigger id="match_type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="word">ord</SelectItem>
                    <SelectItem value="substring">delstreng</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="notes">Notat</Label>
              <Textarea
                id="notes"
                name="notes"
                rows={3}
                defaultValue={row.notes ?? ""}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="is_active"
                name="is_active"
                value="1"
                defaultChecked={row.is_active}
              />
              <Label htmlFor="is_active" className="font-normal">
                Aktiv (vises på metode-siden, brukes ved tagging)
              </Label>
            </div>
            <div className="flex gap-2">
              <SubmitButton pendingLabel="Lagrer…">Lagre</SubmitButton>
              <Button asChild variant="ghost">
                <Link href="/admin/keywords">Avbryt</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <p className="mt-4 text-xs text-muted-foreground">
        Opprettet {fmtDateTime(row.created_at)} · sist endret{" "}
        {fmtDateTime(row.updated_at)} ·{" "}
        <code className="font-mono">{row.id}</code>
      </p>
    </>
  );
}
