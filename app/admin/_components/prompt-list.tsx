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
import { SubmitButton } from "@/app/admin/_components/submit-button";
import { fmtDateTime } from "@/lib/admin/flash";

// Shared prompt-list view. Used by both /admin/job-market/prompts (NAV
// roles tier1+tier2) and /admin/media/prompts (media_tier1+media_tier2).
// Per-domain pages fetch the rows, hand them to <PromptList> with the
// role labels, blurbs, base path, and the domain's setActiveAction.
//
// Design intent: layout + table markup stays here so both domains feel
// identical. Anything that differs (role names, copy, redirect targets,
// migration references in empty state) is a prop.

export type PromptRevision = {
  id: string;
  role: string;
  body: string;
  active: boolean;
  created_at: string;
  created_by: string | null;
};

export type PromptListProps = {
  rows: PromptRevision[];
  // Roles to render, in display order. Each gets its own RoleSection.
  roles: string[];
  roleTitles: Record<string, string>;
  roleBlurbs: Record<string, string>;
  // /admin/job-market/prompts or /admin/media/prompts. No trailing slash.
  basePath: string;
  // Server action that flips the active flag for (id, role).
  setActiveAction: (id: string, role: string) => Promise<void>;
  // Migration id surfaced in the empty state ("er migrasjon 00NN kjørt?").
  emptyStateMigration: string;
};

function snippet(body: string, max = 160): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : flat.slice(0, max - 1) + "…";
}

export function PromptList({
  rows,
  roles,
  roleTitles,
  roleBlurbs,
  basePath,
  setActiveAction,
  emptyStateMigration,
}: PromptListProps) {
  return (
    <div className="flex flex-col gap-6">
      {roles.map((role) => (
        <RoleSection
          key={role}
          role={role}
          rows={rows.filter((r) => r.role === role)}
          title={roleTitles[role] ?? role}
          blurb={roleBlurbs[role] ?? ""}
          basePath={basePath}
          setActiveAction={setActiveAction}
          emptyStateMigration={emptyStateMigration}
        />
      ))}
    </div>
  );
}

type RoleSectionProps = {
  role: string;
  rows: PromptRevision[];
  title: string;
  blurb: string;
  basePath: string;
  setActiveAction: (id: string, role: string) => Promise<void>;
  emptyStateMigration: string;
};

function RoleSection({
  role,
  rows,
  title,
  blurb,
  basePath,
  setActiveAction,
  emptyStateMigration,
}: RoleSectionProps) {
  const active = rows.find((r) => r.active);
  const isTier1 = role.endsWith("tier1") || role === "tier1";

  return (
    <Card className="gap-0 p-0">
      <CardHeader className="flex flex-row items-start justify-between gap-4 px-6 py-4">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.14em]">
            {isTier1 ? (
              <Sparkles className="size-4" />
            ) : (
              <MessageSquareCode className="size-4" />
            )}
            {title}
          </CardTitle>
          <CardDescription className="mt-1 max-w-2xl">{blurb}</CardDescription>
        </div>
        {active ? (
          <Button asChild size="sm" variant="outline">
            <Link href={`${basePath}/${active.id}`}>
              <Plus />
              Lag ny revisjon
            </Link>
          </Button>
        ) : null}
      </CardHeader>

      {rows.length === 0 ? (
        <CardContent className="py-12 text-center text-muted-foreground">
          Ingen revisjoner — er migrasjon {emptyStateMigration} kjørt?
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
                        <Badge
                          variant="outline"
                          className="text-muted-foreground"
                        >
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
                          href={`${basePath}/${r.id}`}
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
