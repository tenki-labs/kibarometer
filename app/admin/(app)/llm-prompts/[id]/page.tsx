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
import { Flash } from "@/app/admin/_components/flash";
import { PageHeader } from "@/app/admin/_components/page-header";
import { SubmitButton } from "@/app/admin/_components/submit-button";
import { fmtDateTime } from "@/lib/admin/flash";
import { sbFetch } from "@/lib/admin/sb";
import { createRevisionAction, setActiveAction } from "../actions";

export const dynamic = "force-dynamic";

type Role = "tier1" | "tier2";

type Revision = {
  id: string;
  role: Role;
  body: string;
  examples: unknown;
  active: boolean;
  created_at: string;
  created_by: string | null;
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const ROLE_TITLE: Record<Role, string> = {
  tier1: "Tier 1 — Discovery",
  tier2: "Tier 2 — Klassifisering",
};

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function isValidRole(s: string): s is Role {
  return s === "tier1" || s === "tier2";
}

function formatExamples(examples: unknown): string {
  if (examples == null) return "";
  try {
    return JSON.stringify(examples, null, 2);
  } catch {
    return "";
  }
}

export default async function LlmPromptRevisionPage({
  params,
  searchParams,
}: Props) {
  const { id } = await params;
  const sp = await searchParams;

  if (!isUuid(id)) {
    return notFound(sp);
  }

  const rows = await sbFetch<Revision[]>(
    `/llm_prompts?id=eq.${encodeURIComponent(id)}` +
      `&select=id,role,body,examples,active,created_at,created_by`,
    { service: true },
  ).catch(() => [] as Revision[]);
  const rev = rows[0];

  if (!rev || !isValidRole(rev.role)) {
    return notFound(sp);
  }

  const create = createRevisionAction.bind(null, rev.role);
  const setActive = setActiveAction.bind(null, rev.id, rev.role);
  const examplesText = formatExamples(rev.examples);

  return (
    <>
      <Flash searchParams={sp} />
      <PageHeader
        eyebrow="Taksonomi"
        title={ROLE_TITLE[rev.role]}
        description={
          <>
            Revisjon opprettet {fmtDateTime(rev.created_at)}
            {rev.created_by ? ` av ${rev.created_by}` : ""}. Lagring nedenfor
            lager en ny rad — denne røres aldri.
          </>
        }
        action={
          <Button asChild variant="ghost">
            <Link href="/admin/llm-prompts">
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
                <SubmitButton size="sm" variant="outline" pendingLabel="Aktiverer…">
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
            action={create}
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
              {rev.role === "tier2" ? (
                <p className="text-xs text-muted-foreground">
                  Må inneholde plassholderen{" "}
                  <code className="font-mono">{"{{categories_block}}"}</code> —{" "}
                  <code className="font-mono">lib/admin/llm-classify.ts</code>{" "}
                  erstatter den med aktiv taksonomi før hvert kall.
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
                <Link href="/admin/llm-prompts">Avbryt</Link>
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

function notFound(sp: Record<string, string | string[] | undefined>) {
  return (
    <>
      <Flash searchParams={sp} />
      <PageHeader
        eyebrow="Taksonomi"
        title="Revisjon ikke funnet"
        action={
          <Button asChild variant="outline">
            <Link href="/admin/llm-prompts">
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
