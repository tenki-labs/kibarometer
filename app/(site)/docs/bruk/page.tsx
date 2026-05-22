// app/(site)/docs/bruk/page.tsx — methodology page for the /bruk pillar.
//
// Editable prose lives in public.site_content (slug = docs-bruk). Bruk has no
// data pipeline diagram (it's a survey, not an ingest pipeline), so the layout
// is prose + a static "Hvordan måler vi" detail block + cite-ability links.

import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { sb } from "@/lib/supabase";
import { renderMarkdown } from "@/lib/admin/markdown";

type SiteContent = {
  slug: string;
  title: string;
  body_md: string;
};

export const metadata: Metadata = {
  title: "Bruk — Metode og data",
  description:
    "Hvordan vi måler AI-bruk i Norge: spørreundersøkelse, bekreftelse, og hva tallene faktisk forteller.",
  alternates: { canonical: "/docs/bruk" },
};

export const dynamic = "force-dynamic";

export default async function DocsBrukPage() {
  const rows = await sb<SiteContent[]>(
    "/site_content?slug=eq.docs-bruk&select=slug,title,body_md",
  );

  const row = rows[0];
  if (!row) notFound();
  const { title, body_md: body } = row;

  return (
    <main className="metode">
      <Breadcrumb className="mb-6">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/">Hjem</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/docs">Dokumentasjon</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Bruk</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <h1 className="title">{title}</h1>

      {renderMarkdown(body)}

      <section className="mt-12">
        <h2>Tekniske detaljer</h2>
        <table>
          <tbody>
            <tr>
              <th>Innsamling</th>
              <td>
                Selvrapportert via skjema på /bruk. Bekreftet via lenke på
                e-post (gyldig i 24 timer).
              </td>
            </tr>
            <tr>
              <th>Aggregering</th>
              <td>
                Forhåndsberegnet snapshot oppdateres hvert 15. minutt av
                cron-jobben <code>bruk-refresh-stats</code>. Bare bekreftede
                svar telles.
              </td>
            </tr>
            <tr>
              <th>Personvern</th>
              <td>
                E-postadresser, IP-adresser og brukeragenter lagres som
                irreversible SHA-256-hashes for sporing av misbruk.
                Individuelle svar vises aldri offentlig. Aggregerte tall
                publiseres uten reidentifikasjon.
              </td>
            </tr>
            <tr>
              <th>Sletting</th>
              <td>
                Selvbetjent via lenke i bekreftelsesmailen. Slettingen er
                permanent og påvirker neste snapshot-oppdatering. Ventende
                rader uten bekreftelse slettes etter 30 dager.
              </td>
            </tr>
            <tr>
              <th>Skjevhet</th>
              <td>
                Selvrekruttert utvalg, ikke representativt. Skal siteres som
                kohortstudie. Sammenlignbarhet med befolkningen i Norge er
                begrenset.
              </td>
            </tr>
            <tr>
              <th>Lisens</th>
              <td>
                Aggregerte tall er publisert under CC-BY 4.0. Bruk dem
                gjerne — krediter Kibarometer.
              </td>
            </tr>
            <tr>
              <th>Maskinlesbar</th>
              <td>
                <Link href="/api/v1/bruk/snapshot">
                  /api/v1/bruk/snapshot
                </Link>{" "}
                — JSON med samme tall som vises på /bruk.
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </main>
  );
}
