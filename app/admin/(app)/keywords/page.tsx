import { Plus, RefreshCw, Tag } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Flash } from "@/app/admin/_components/flash";
import { KeywordRow } from "@/app/admin/_components/keyword-row";
import { PageHeader } from "@/app/admin/_components/page-header";
import { StatCard } from "@/app/admin/_components/stat-card";
import { SubmitButton } from "@/app/admin/_components/submit-button";
import { sbFetch } from "@/lib/admin/sb";
import { reprocessAction } from "../job-market/actions";
import { createAction } from "./actions";

const SELECT_COLS =
  "id,term,language,category,match_type,status,notes,created_at,updated_at";

const CATEGORY_LABEL: Record<string, string> = {
  tool: "Verktøy",
  role: "Rolle / tittel",
  concept: "Begrep",
};

const CATEGORIES = ["tool", "role", "concept"] as const;

type Keyword = {
  id: string;
  term: string;
  language: "any" | "no" | "en";
  category: "tool" | "role" | "concept";
  match_type: "word" | "substring";
  status: "canonical" | "trial" | "rejected";
  notes: string | null;
  created_at: string;
  updated_at: string;
};

// canonical and trial both match in tagging; only canonical counts publicly.
const isMatching = (k: Keyword) => k.status === "canonical" || k.status === "trial";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function CategoryTable({ rows }: { rows: Keyword[] }) {
  if (rows.length === 0) {
    return (
      <div className="px-6 py-12 text-center text-sm text-muted-foreground">
        Ingen i denne kategorien.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Term</TableHead>
            <TableHead>Språk</TableHead>
            <TableHead>Match</TableHead>
            <TableHead>Aktiv</TableHead>
            <TableHead>Endret</TableHead>
            <TableHead className="text-right">Handlinger</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((kw) => (
            <KeywordRow key={kw.id} kw={kw} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default async function KeywordsPage({ searchParams }: Props) {
  const params = await searchParams;
  const rows = await sbFetch<Keyword[]>(
    `/keywords?select=${SELECT_COLS}&order=category.asc,term_norm.asc`,
    { service: true },
  );
  const byCategory: Record<string, Keyword[]> = {
    tool: [],
    role: [],
    concept: [],
  };
  for (const r of rows) {
    (byCategory[r.category] ??= []).push(r);
  }

  const totalActive = rows.filter(isMatching).length;
  const counts = CATEGORIES.map((c) => ({
    cat: c,
    total: byCategory[c]?.length ?? 0,
    active: (byCategory[c] ?? []).filter(isMatching).length,
  }));

  return (
    <>
      <Flash searchParams={params} />
      <PageHeader
        eyebrow="Taksonomi"
        title="Nøkkelord"
        description="Inkluderingslisten avgjør hva som teller som AI-relatert. Endringer slår igjennom på neste re-tagging av nav_postings."
        action={
          <form action={reprocessAction}>
            <SubmitButton variant="outline" pendingLabel="Re-tagger…">
              <RefreshCw />
              Re-tag alle stillinger
            </SubmitButton>
          </form>
        }
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label="Aktive totalt"
          value={totalActive}
          hint={`${rows.length} totalt (inkl. inaktive)`}
        />
        {counts.map((c) => (
          <StatCard
            key={c.cat}
            label={CATEGORY_LABEL[c.cat]}
            value={c.active}
            hint={`av ${c.total}`}
          />
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.14em]">
            <Plus className="size-4" />
            Nytt nøkkelord
          </CardTitle>
          <CardDescription>
            Lagrer som aktivt. Bruk Re-tag-knappen øverst for å oppdatere
            eksisterende stillinger.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={createAction}
            className="flex flex-col gap-4"
            aria-label="Nytt nøkkelord"
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[2fr_1fr_1fr_1fr_auto] md:items-end">
              <div className="flex flex-col gap-2">
                <Label htmlFor="term">Term</Label>
                <Input
                  id="term"
                  name="term"
                  required
                  placeholder="f.eks. PyTorch"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="language">Språk</Label>
                <Select name="language" defaultValue="any">
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
                <Select name="category" defaultValue="tool">
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
                <Select name="match_type" defaultValue="word">
                  <SelectTrigger id="match_type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="word">ord</SelectItem>
                    <SelectItem value="substring">delstreng</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <SubmitButton className="md:self-end" pendingLabel="Lagrer…">
                <Plus />
                Legg til
              </SubmitButton>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="notes">Notat (valgfritt)</Label>
              <Input
                id="notes"
                name="notes"
                placeholder="kontekst, FP-risiko, osv."
              />
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="mt-6 gap-0 p-0">
        <CardHeader className="px-6 py-4">
          <CardTitle className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.14em]">
            <Tag className="size-4" />
            Inkluderingsliste
          </CardTitle>
          <CardDescription>
            Filtrer etter kategori. Inaktive rader er dempet.
          </CardDescription>
        </CardHeader>
        <Tabs defaultValue="tool" className="gap-0">
          <div className="border-b border-border px-6 pb-3">
            <TabsList>
              {CATEGORIES.map((cat) => {
                const c = counts.find((x) => x.cat === cat)!;
                return (
                  <TabsTrigger key={cat} value={cat}>
                    {CATEGORY_LABEL[cat]}{" "}
                    <span className="ml-1.5 text-muted-foreground">
                      {c.active}/{c.total}
                    </span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>
          {CATEGORIES.map((cat) => (
            <TabsContent key={cat} value={cat} className="m-0">
              <CategoryTable rows={byCategory[cat] ?? []} />
            </TabsContent>
          ))}
        </Tabs>
      </Card>
    </>
  );
}
