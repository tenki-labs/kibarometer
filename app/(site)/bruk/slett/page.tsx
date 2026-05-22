// app/(site)/bruk/slett/page.tsx — self-serve GDPR delete confirmation.
//
// Reads the user's long-lived delete token from ?token=… and renders a single
// "Slett mine svar" button that POSTs to deleteSelfAction. Two-step (read +
// click) to avoid accidental delete on a misclicked email link.

import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";

import { deleteSelfAction } from "../actions";

export const metadata: Metadata = {
  title: "Slett dine svar",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ token?: string | string[]; error?: string }>;
};

export default async function SlettPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const token = Array.isArray(params.token) ? params.token[0] : params.token;
  const error = params.error;

  if (!token) {
    return (
      <main className="mx-auto flex min-h-[calc(100svh-3.5rem)] w-full max-w-xl flex-col justify-center gap-6 px-6 py-12">
        <h1 className="text-3xl font-medium tracking-tight">Ugyldig lenke</h1>
        <p className="text-base text-muted-foreground">
          Sletteringslenken må komme fra bekreftelsesmailen vi sendte da du
          registrerte deg. Finner du ikke mailen, kan du kontakte oss.
        </p>
        <div>
          <Button asChild variant="outline">
            <Link href="/bruk">Tilbake til /bruk</Link>
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-[calc(100svh-3.5rem)] w-full max-w-xl flex-col justify-center gap-8 px-6 py-12">
      <div>
        <h1 className="text-3xl font-medium tracking-tight">
          Slett dine svar?
        </h1>
        <p className="mt-4 text-base text-muted-foreground">
          Hvis du fortsetter, sletter vi e-postadressen din og alle svarene
          dine fra Kibarometers database. Handlingen kan ikke angres. Du kan
          alltids registrere deg på nytt senere hvis du ombestemmer deg.
        </p>
        {error ? (
          <p className="mt-3 text-sm text-destructive">
            Noe gikk galt. Prøv igjen, eller kontakt oss hvis problemet
            vedvarer.
          </p>
        ) : null}
      </div>

      <form
        action={deleteSelfAction}
        className="flex flex-col gap-3 rounded-lg border border-border bg-card p-6"
      >
        <input type="hidden" name="token" value={token} />
        <Button type="submit" variant="destructive">
          Slett mine svar permanent
        </Button>
        <Button asChild variant="ghost">
          <Link href="/bruk">Avbryt</Link>
        </Button>
      </form>
    </main>
  );
}
