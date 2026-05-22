// app/(site)/bruk/bekreft/page.tsx — magic-link confirmation handler.
//
// Server component. Reads ?token=… and calls confirmTokenServerSide(); on
// success, redirects to /bruk/takk. On failure (expired, invalid, already
// used), renders an "issue new link" form that POSTs to
// reissueConfirmEmailAction.
//
// This is the one place in the codebase where a server component mutates DB
// state directly. Justified because the magic link is a GET from email — we
// can't redirect-and-form because the user already clicked.

import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  confirmTokenServerSide,
  reissueConfirmEmailAction,
} from "../actions";

export const metadata: Metadata = {
  title: "Bekreft registrering",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ token?: string | string[] }>;
};

export default async function BekreftPage({ searchParams }: PageProps) {
  const { token } = await searchParams;
  const plaintext = Array.isArray(token) ? token[0] : token;
  if (!plaintext) {
    return renderExpired();
  }

  const result = await confirmTokenServerSide(plaintext);
  if (result.ok) {
    redirect("/bruk/takk");
  }
  return renderExpired();
}

function renderExpired() {
  return (
    <main className="mx-auto flex min-h-[calc(100svh-3.5rem)] w-full max-w-xl flex-col justify-center gap-8 px-6 py-12">
      <div>
        <h1 className="text-3xl font-medium tracking-tight">
          Lenken er utløpt
        </h1>
        <p className="mt-4 text-base text-muted-foreground">
          Bekreftelseslenken er ikke lenger gyldig, eller den er allerede
          brukt. Skriv inn e-postadressen din på nytt, så sender vi en ny
          lenke.
        </p>
      </div>

      <form
        action={reissueConfirmEmailAction}
        className="flex flex-col gap-3 rounded-lg border border-border bg-card p-6"
      >
        {/* honeypot */}
        <input
          type="text"
          name="favoritfarge"
          tabIndex={-1}
          autoComplete="off"
          style={{ position: "absolute", left: "-9999px" }}
          aria-hidden="true"
        />
        <Label htmlFor="bekreft-email" className="sr-only">
          E-post
        </Label>
        <Input
          id="bekreft-email"
          type="email"
          name="email"
          placeholder="din@e-post.no"
          required
          autoComplete="email"
        />
        <Button type="submit">Send ny bekreftelseslenke</Button>
      </form>
    </main>
  );
}
