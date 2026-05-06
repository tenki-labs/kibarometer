"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

// Tiny client component for the keyword Delete button. Wraps a server
// action invocation in a window.confirm() prompt because the project
// doesn't ship shadcn's AlertDialog primitive yet — adding it just for
// one button felt like scope creep. If a second confirm-destructive
// flow shows up later, swap this for AlertDialog and import from one
// place. Until then this stays a 30-line client component.
//
// Usage: <DeleteKeywordButton id={kw.id} term={kw.term} action={deleteAction} />
//   - action is bound on the server side: `deleteAction.bind(null, kw.id)`
//     wouldn't work here (server actions need to be passed by reference,
//     not bound through props in client components — the binding has to
//     happen client-side too). So we accept the action plus the id and
//     let the client invoke it through useTransition for a pending state.

type Props = {
  term: string;
  action: (id: string) => Promise<void>;
  id: string;
};

export function DeleteKeywordButton({ term, action, id }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    const confirmed = window.confirm(
      `Slett nøkkelord «${term}»?\n\n` +
        "Dette kan ikke angres. Treff i eksisterende stillinger og " +
        "artikler fjernes ved neste reprosessering / fetch-classify.",
    );
    if (!confirmed) return;
    setError(null);
    startTransition(async () => {
      try {
        await action(id);
      } catch (err) {
        // redirect() throws a NEXT_REDIRECT digest — not a real error.
        // Anything else surfaces here.
        const isRedirect =
          err instanceof Error &&
          "digest" in err &&
          typeof (err as { digest: unknown }).digest === "string" &&
          (err as { digest: string }).digest.startsWith("NEXT_REDIRECT");
        if (isRedirect) throw err;
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onClick}
        disabled={pending}
        className="text-destructive hover:text-destructive"
      >
        {pending ? "Sletter…" : "Slett"}
      </Button>
      {error ? (
        <span className="text-xs text-destructive" role="alert">
          {error}
        </span>
      ) : null}
    </>
  );
}
