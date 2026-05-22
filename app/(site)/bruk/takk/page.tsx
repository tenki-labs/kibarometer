// app/(site)/bruk/takk/page.tsx — success page reached after the user clicks
// the confirmation link in their email.

import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Takk for at du registrerte deg",
  robots: { index: false, follow: false },
};

export default function TakkPage() {
  return (
    <main className="mx-auto flex min-h-[calc(100svh-3.5rem)] w-full max-w-xl flex-col justify-center gap-8 px-6 py-12">
      <div>
        <h1 className="text-3xl font-medium tracking-tight">
          Takk for at du registrerte deg.
        </h1>
        <p className="mt-4 text-base text-muted-foreground">
          Svarene dine telles inn i de offentlige aggregerte tallene på{" "}
          <Link href="/bruk" className="underline underline-offset-2">
            /bruk
          </Link>
          . Vi viser aldri individuelle e-postadresser eller svar publikt.
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          Du har fått en e-post fra oss med en personlig sletteringslenke. Ta
          vare på den hvis du vil kunne slette svarene dine senere uten å
          kontakte oss.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button asChild>
          <Link href="/bruk">Se aggregerte tall</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Tilbake til forsiden</Link>
        </Button>
      </div>
    </main>
  );
}
