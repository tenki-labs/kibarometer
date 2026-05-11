import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/app/admin/_components/page-header";
import { SubmitButton } from "@/app/admin/_components/submit-button";
import { fmtDateTime } from "@/lib/admin/flash";

// Shared revision-editor view. Renders a single llm_prompts row plus a
// "Lag ny revisjon" form prefilled with current body/examples. Used by
// /admin/job-market/prompts/[id] and /admin/media/prompts/[id]. Per-
// domain pages do the row fetch + role validation, then hand the row
// and the bound server actions to this component.

export type PromptRevisionFull = {
  id: string;
  role: string;
  body: string;
  examples: unknown;
  active: boolean;
  created_at: string;
  created_by: string | null;
};

export type PromptRevisionEditorProps = {
  rev: PromptRevisionFull;
  // E.g. "Tier 1 — Discovery" or "Media · Tier 1 — Relevans".
  title: string;
  // Eyebrow shown above the title — domain-specific ("Arbeidsmarked", "Medie-dekning").
  eyebrow: string;
  basePath: string;
  // Bound server actions for this row.
  createRevision: (formData: FormData) => Promise<void>;
  setActive: () => Promise<void>;
  // Whether this role's prompt body needs the {{categories_block}}
  // placeholder. True for tier2-style classification prompts.
  requiresCategoriesBlock: boolean;
};

function formatExamples(examples: unknown): string {
  if (examples == null) return "";
  try {
    return JSON.stringify(examples, null, 2);
  } catch {
    return "";
  }
}

export function PromptRevisionEditor({
  rev,
  title,
  eyebrow,
  basePath,
  createRevision,
  setActive,
  requiresCategoriesBlock,
}: PromptRevisionEditorProps) {
  const examplesText = formatExamples(rev.examples);

  return (
    <>
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={
          <>
            Revisjon opprettet {fmtDateTime(rev.created_at)}
            {rev.created_by ? ` av ${rev.created_by}` : ""}. Lagring nedenfor
            lager en ny rad — denne røres aldri.
          </>
        }
        action={
          <Button asChild variant="ghost">
            <Link href={basePath}>
              <ArrowLeft />
              Tilbake
            </Link>
          </Button>
        }
      />

      <Card className="mb-6">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em]">
              Status
            </CardTitle>
            <CardDescription className="mt-1">
              {rev.active
                ? "Denne revisjonen er aktiv og blir brukt av neste cron-tikk."
                : "Inaktiv — endringer her påvirker ikke kjøringen før du setter den aktiv."}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {rev.active ? (
              <Badge>Aktiv</Badge>
            ) : (
              <form action={setActive}>
                <SubmitButton
                  size="sm"
                  variant="outline"
                  pendingLabel="Aktiverer…"
                >
                  Sett aktiv
                </SubmitButton>
              </form>
            )}
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-mono text-xs uppercase tracking-[0.18em]">
            Lag ny revisjon
          </CardTitle>
          <CardDescription>
            Forhåndsutfylt med innholdet fra denne revisjonen. Lagring oppretter
            en ny rad — du må eksplisitt sette den aktiv etterpå.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={createRevision}
            className="flex flex-col gap-4"
            aria-label={`Lag ny ${rev.role}-revisjon`}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="body">Brødtekst</Label>
              <Textarea
                id="body"
                name="body"
                rows={20}
                required
                defaultValue={rev.body}
                className="font-mono text-sm"
              />
              {requiresCategoriesBlock ? (
                <p className="text-xs text-muted-foreground">
                  Må inneholde plassholderen{" "}
                  <code className="font-mono">{"{{categories_block}}"}</code> —
                  pipelinen erstatter den med aktiv taksonomi før hvert kall.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Modellen får hele brødteksten som system-melding. Hold den
                  kort — eksempler under hjelper mer enn lange instruksjoner.
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="examples">Examples (JSON, valgfritt)</Label>
              <Textarea
                id="examples"
                name="examples"
                rows={12}
                defaultValue={examplesText}
                placeholder='[{"input": {...}, "output": {...}}]'
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Lagres som <code className="font-mono">jsonb</code>. La feltet
                stå tomt for <code className="font-mono">null</code>. Strukturen
                er ikke håndhevet — bruk <em>few-shot</em>-formen pipelinen
                forventer.
              </p>
            </div>

            <div className="flex gap-2">
              <SubmitButton pendingLabel="Lagrer…">Lagre ny revisjon</SubmitButton>
              <Button asChild variant="ghost">
                <Link href={basePath}>Avbryt</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <p className="mt-4 text-xs text-muted-foreground">
        Revisjons-id <code className="font-mono">{rev.id}</code>
      </p>
    </>
  );
}

export function PromptRevisionNotFound({
  eyebrow,
  basePath,
}: {
  eyebrow: string;
  basePath: string;
}) {
  return (
    <>
      <PageHeader
        eyebrow={eyebrow}
        title="Revisjon ikke funnet"
        action={
          <Button asChild variant="outline">
            <Link href={basePath}>
              <ArrowLeft />
              Tilbake
            </Link>
          </Button>
        }
      />
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Ingen prompt-revisjon med denne id-en.
        </CardContent>
      </Card>
    </>
  );
}
