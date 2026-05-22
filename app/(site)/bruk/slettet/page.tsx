// app/(site)/bruk/slettet/page.tsx — confirmation that the user's data has
// been deleted.

import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Svarene er slettet",
  robots: { index: false, follow: false },
};

export default function SlettetPage() {
  return (
    <main className="mx-auto flex min-h-[calc(100svh-3.5rem)] w-full max-w-xl flex-col justify-center gap-8 px-6 py-12">
      <div>
        <h1 className="text-3xl font-medium tracking-tight">
          Svarene dine er slettet.
        </h1>
        <p className="mt-4 text-base text-muted-foreground">
          E-postadressen din og svarene er fjernet fra databasen. De
          aggregerte tallene på /bruk oppdateres automatisk neste gang
          snapshot-cronen kjører (innen 15 minutter).
        </p>
      </div>

      <div>
        <Button asChild variant="outline">
          <Link href="/">Tilbake til forsiden</Link>
        </Button>
      </div>
    </main>
  );
}
