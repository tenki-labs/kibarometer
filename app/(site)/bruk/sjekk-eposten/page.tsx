// app/(site)/bruk/sjekk-eposten/page.tsx — PRG landing shown after a successful
// submit. Tells the user to click the link in their inbox; offers a resend form
// for the case where the email never arrived. Also the redirect target for the
// "already confirmed" path (enumeration defense — same copy regardless).

import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { reissueConfirmEmailAction } from "../actions";

export const metadata: Metadata = {
  title: "Sjekk e-posten din",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function SjekkEpostenPage() {
  return (
    <main className="mx-auto flex min-h-[calc(100svh-3.5rem)] w-full max-w-xl flex-col justify-center gap-8 px-6 py-12">
      <div>
        <h1 className="text-3xl font-medium tracking-tight">
          Sjekk e-posten din
        </h1>
        <p className="mt-4 text-base text-muted-foreground">
          Hvis e-posten du oppga er ny for oss, har vi sendt en
          bekreftelseslenke til den. Klikk på lenken for å fullføre
          registreringen.
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          Sjekk gjerne spam- eller søppelmappa. Lenken er gyldig i 24 timer.
        </p>
      </div>

      <form
        action={reissueConfirmEmailAction}
        className="flex flex-col gap-3 rounded-lg border border-border bg-card p-6"
      >
        <p className="text-sm font-medium">Fikk du ikke noen e-post?</p>
        <p className="text-xs text-muted-foreground">
          Skriv inn e-postadressen din igjen, så sender vi en ny lenke.
        </p>
        {/* honeypot */}
        <input
          type="text"
          name="favoritfarge"
          tabIndex={-1}
          autoComplete="off"
          style={{ position: "absolute", left: "-9999px" }}
          aria-hidden="true"
        />
        <Label htmlFor="reissue-email" className="sr-only">
          E-post
        </Label>
        <Input
          id="reissue-email"
          type="email"
          name="email"
          placeholder="din@e-post.no"
          required
          autoComplete="email"
        />
        <Button type="submit" variant="outline">
          Send ny bekreftelseslenke
        </Button>
      </form>

      <p className="text-sm text-muted-foreground">
        <Link href="/bruk" className="underline underline-offset-2">
          Tilbake til /bruk
        </Link>
      </p>
    </main>
  );
}
