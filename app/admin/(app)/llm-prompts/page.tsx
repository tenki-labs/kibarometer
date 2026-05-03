import Link from "next/link";
import { ArrowRight, MessageSquareCode, Plus, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Flash } from "@/app/admin/_components/flash";
import { PageHeader } from "@/app/admin/_components/page-header";
import { SubmitButton } from "@/app/admin/_components/submit-button";
import { fmtDateTime } from "@/lib/admin/flash";
import { sbFetch } from "@/lib/admin/sb";
import { setActiveAction } from "./actions";

export const dynamic = "force-dynamic";

type Role = "tier1" | "tier2";

type Revision = {
  id: string;
  role: Role;
  body: string;
  active: boolean;
  created_at: string;
  created_by: string | null;
};

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const ROLE_TITLE: Record<Role, string> = {
  tier1: "Tier 1 — Discovery",
  tier2: "Tier 2 — Klassifisering",
};

const ROLE_BLURB: Record<Role, string> = {
  tier1:
    "Verbatim AI-frase-uttrekk fra alle nye stillinger. Lest av lib/admin/llm-discover.ts på hvert cron-tikk.",
  tier2:
    "Klassifiserer AI-positive stillinger inn i taksonomi-kategoriene. Må inneholde {{categories_block}} — erstattes ved kjøretid.",
};

function snippet(body: string, max = 160): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : flat.slice(0, max - 1) + "…";
}

export default async function LlmPromptsListPage({ searchParams }: Props) {
  const sp = await searchParams;

  const rows = await sbFetch<Revision[]>(
    "/llm_prompts?select=id,role,body,active,created_at,created_by" +
      "&order=role.asc,created_at.desc",
    { service: true },
  ).catch(() => [] as Revision[]);

  const tier1 = rows.filter((r) => r.role === "tier1");
  const tier2 = rows.filter((r) => r.role === "tier2");

  return (
    <>
      <Flash searchParams={sp} />
      <PageHeader
        eyebrow="Taksonomi"
        title="Systemprompt"
        description={
          <>
            Versjonerte system-prompts for LLM-pipeline. Hver lagring lager en
            ny rad — historikken er uforanderlig. Én aktiv prompt per rolle —
            den blir lest av{" "}
            <code className="font-mono">lib/admin/llm-discover.ts</code> og{" "}
            <code className="font-mono">lib/admin/llm-classify.ts</code>{" "}
            uten redeploy.
          </>
        }
      />

      <div className="flex flex-col gap-6">
        <RoleSection role="tier1" rows={tier1} />
        <RoleSection role="tier2" rows={tier2} />
      </div>
    </>
  );
}

function RoleSection({ role, rows }: { role: Role; rows: Revision[] }) {
  const active = rows.find((r) => r.active);

  return (
    <Card className="gap-0 p-0">
      <CardHeader className="flex flex-row items-start justify-between gap-4 px-6 py-4">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.14em]">
            {role === "tier1" ? (
              <Sparkles className="size-4" />
            ) : (
              <MessageSquareCode className="size-4" />
            )}
            {ROLE_TITLE[role]}
          </CardTitle>
          <CardDescription className="mt-1 max-w-2xl">
            {ROLE_BLURB[role]}
          </CardDescription>
        </div>
        {active ? (
          <Button asChild size="sm" variant="outline">
            <Link href={`/admin/llm-prompts/${active.id}`}>
              <Plus />
              Lag ny revisjon
            </Link>
          </Button>
        ) : null}
      </CardHeader>

      {rows.length === 0 ? (
        <CardContent className="py-12 text-center text-muted-foreground">
          Ingen revisjoner — er migrasjon 0018 kjørt?
        </CardContent>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">Opprettet</TableHead>
                <TableHead className="w-20">Status</TableHead>
                <TableHead>Forhåndsvisning</TableHead>
                <TableHead className="w-44 text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const set = setActiveAction.bind(null, r.id, r.role);
                return (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {fmtDateTime(r.created_at)}
                    </TableCell>
                    <TableCell>
                      {r.active ? (
                        <Badge>Aktiv</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          Inaktiv
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[42rem] font-mono text-xs text-muted-foreground">
                      {snippet(r.body)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {r.active ? null : (
                          <form action={set}>
                            <SubmitButton
                              size="sm"
                              variant="outline"
                              pendingLabel="Aktiverer…"
                            >
                              Sett aktiv
                            </SubmitButton>
                          </form>
                        )}
                        <Link
                          href={`/admin/llm-prompts/${r.id}`}
                          className="inline-flex items-center gap-1 text-xs font-medium hover:opacity-80"
                        >
                          Vis
                          <ArrowRight className="size-3.5" />
                        </Link>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}
