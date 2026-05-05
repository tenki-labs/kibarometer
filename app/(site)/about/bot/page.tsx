// app/(site)/about/bot/page.tsx — public identification page for the
// kibarometer crawler. Linked from the User-Agent string we send when
// fetching brreg data:
//   kibarometerbot/1.0 (+https://kibarometer.no/about/bot;
//     nlod-attribution=brreg)
//
// Per NLOD 2.0 etiquette: identify yourself, name a contact, document
// the data sources, and offer a clear opt-out path.

import type { Metadata } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  title: "kibarometerbot — om vår crawler",
  description:
    "Identifikasjon og kontaktinformasjon for kibarometer.no's data-henting fra åpne offentlige registre.",
  alternates: { canonical: "/about/bot" },
  openGraph: { url: "/about/bot" },
  robots: { index: true, follow: true },
};

export const revalidate = 86400; // daily

export default function BotPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16 sm:px-6 sm:py-20">
      <p className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        kibarometer.no
      </p>
      <h1 className="mt-3 text-4xl font-semibold leading-[1.05] tracking-tight">
        kibarometerbot
      </h1>
      <p className="mt-4 text-base text-muted-foreground">
        En automatisert klient som henter åpent offentlig register-data for
        analyse. Drevet av Tenki Labs på vegne av kibarometer.no.
      </p>

      <section className="mt-12 space-y-3">
        <h2 className="text-xl font-semibold tracking-tight">User-Agent</h2>
        <pre className="overflow-x-auto rounded-md border bg-muted p-4 text-xs">
{`kibarometerbot/1.0 (+${SITE_URL}/about/bot; nlod-attribution=brreg)`}
        </pre>
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="text-xl font-semibold tracking-tight">Hva henter vi?</h2>
        <p className="text-sm text-muted-foreground">
          Per i dag kun fra Brønnøysundregistrene (data.brreg.no), under
          NLOD 2.0-lisensen:
        </p>
        <ul className="list-disc space-y-1 pl-6 text-sm text-muted-foreground">
          <li>
            <code className="text-xs">/enheter</code> — daglig poll av nye
            registreringer (filtrert på registreringsdato).
          </li>
          <li>
            <code className="text-xs">/enheter/&#123;orgnr&#125;/roller</code>{" "}
            — rolle-holdere (kun fysiske personer lagres; juridiske
            person-roller filtreres bort ved henting).
          </li>
          <li>
            <code className="text-xs">/enheter/lastned</code> — én gang per
            installasjon, for historisk baseline (omtrent én gang per år).
          </li>
        </ul>
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="text-xl font-semibold tracking-tight">Etikette</h2>
        <ul className="list-disc space-y-1 pl-6 text-sm text-muted-foreground">
          <li>250 ms ventetid mellom hver forespørsel (~4 req/s peak).</li>
          <li>Eksponentiell backoff på 5xx og 429 (respekterer Retry-After).</li>
          <li>NLOD 2.0-attribusjon i User-Agent og på alle publiserte sider.</li>
          <li>
            Vi bruker bulk-dumpen for store backfills og det filtrerte
            API-et bare for daglige inkrementer — som anbefalt av brreg.
          </li>
        </ul>
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="text-xl font-semibold tracking-tight">Personvern</h2>
        <p className="text-sm text-muted-foreground">
          Personopplysninger på rolle-holdere (fødselsdato, navn) lagres
          kun for analyse. De vises aldri på offentlige sider —{" "}
          <a href="/oppstart" className="underline underline-offset-2">/oppstart</a>{" "}
          publiserer kun aggregater. Persondata slettes 5 år etter at
          foretaket er slettet fra brreg (GDPR Art. 5(1)(e),
          lagringsbegrensning).
        </p>
        <p className="text-sm text-muted-foreground">
          Ønsker du data om deg slettet på forespørsel, kontakt:{" "}
          <a
            href="mailto:oscar@winsights.no"
            className="underline underline-offset-2"
          >
            oscar@winsights.no
          </a>
          .
        </p>
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="text-xl font-semibold tracking-tight">
          Vil du at vi skal stoppe?
        </h2>
        <p className="text-sm text-muted-foreground">
          Hvis du representerer en kilde vi henter fra og ønsker å pause
          eller stoppe vår crawler, send en e-post til adressen over med
          domenet/endepunktet, så blokkerer vi det innen 24 timer.
        </p>
      </section>

      <p className="mt-12 text-xs text-muted-foreground">
        <a href="/" className="underline underline-offset-2">← kibarometer.no</a>
      </p>
    </main>
  );
}
