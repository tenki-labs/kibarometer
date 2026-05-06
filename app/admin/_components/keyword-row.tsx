import Link from "next/link";
import { Check, Minus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { fmtDateTime } from "@/lib/admin/flash";
import { deleteAction, toggleAction } from "@/app/admin/(app)/keywords/actions";
import { DeleteKeywordButton } from "./delete-keyword-button";
import { SubmitButton } from "./submit-button";

const LANGUAGE_LABEL: Record<string, string> = {
  any: "alle",
  no: "norsk",
  en: "engelsk",
};
const LANGUAGE_DOT: Record<string, string> = {
  any: "bg-blue-500",
  no: "bg-emerald-500",
  en: "bg-rose-500",
};
const MATCH_LABEL: Record<string, string> = {
  word: "ord",
  substring: "delstreng",
};

type KeywordRowData = {
  id: string;
  term: string;
  language: "any" | "no" | "en" | string;
  match_type: "word" | "substring" | string;
  status: "canonical" | "trial" | "rejected" | string;
  notes: string | null;
  updated_at: string;
};

function langBadge(l: string) {
  const dot = LANGUAGE_DOT[l] ?? "bg-muted-foreground";
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <span className={cn("size-1.5 rounded-full", dot)} aria-hidden />
      <span>{LANGUAGE_LABEL[l] ?? l}</span>
    </Badge>
  );
}

export function KeywordRow({ kw }: { kw: KeywordRowData }) {
  const toggle = toggleAction.bind(null, kw.id);
  // canonical or trial both match in tagging; only canonical counts publicly.
  const matchesInTagging = kw.status === "canonical" || kw.status === "trial";
  // Dim only the term/notes — keep badges + actions readable so the
  // recovery affordance ("Aktiver") stays visible on inactive rows.
  return (
    <TableRow>
      <TableCell>
        <div className={cn("font-medium", !matchesInTagging && "text-muted-foreground")}>
          {kw.term}
        </div>
        {kw.notes ? (
          <div className="mt-1 text-xs text-muted-foreground">{kw.notes}</div>
        ) : null}
      </TableCell>
      <TableCell>{langBadge(kw.language)}</TableCell>
      <TableCell>
        <Badge variant="outline" className="font-mono text-[0.65rem] font-normal">
          {MATCH_LABEL[kw.match_type] ?? kw.match_type}
        </Badge>
      </TableCell>
      <TableCell>
        {matchesInTagging ? (
          <>
            <Check className="size-4 text-emerald-600" aria-hidden />
            <span className="sr-only">Aktiv</span>
          </>
        ) : (
          <>
            <Minus className="size-4 text-muted-foreground" aria-hidden />
            <span className="sr-only">Inaktiv</span>
          </>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
        {fmtDateTime(kw.updated_at)}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/admin/keywords/${kw.id}`}>Endre</Link>
          </Button>
          {matchesInTagging ? (
            // Active keyword: only show toggle (Deaktiver) — destructive
            // delete sits behind a confirm in the inactive branch where
            // it's the more useful action.
            <form action={toggle}>
              <SubmitButton variant="ghost" size="sm">
                Deaktiver
              </SubmitButton>
            </form>
          ) : (
            // Inactive keyword: offer both Aktiver (toggle back) and
            // Slett (hard delete). Operators reviewing rejected
            // candidates need a way to clean up the catalogue rather
            // than just hide rows.
            <>
              <form action={toggle}>
                <SubmitButton variant="ghost" size="sm">
                  Aktiver
                </SubmitButton>
              </form>
              <DeleteKeywordButton
                id={kw.id}
                term={kw.term}
                action={deleteAction}
              />
            </>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
