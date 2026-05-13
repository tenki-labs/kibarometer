// app/(site)/docs/offentlig-sektor/page.tsx — operational docs for the
// /offentlig pipeline. Editable summary prose lives in public.site_content
// (slug = docs-offentlig); the SVG flow diagram + "Tekniske detaljer"
// block are hardcoded JSX since they must track code (cron times, table
// names, endpoints).

import Link from "next/link";
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

import { PipelineFlow } from "../_components/pipeline-flow";

type SiteContent = {
  slug: string;
  title: string;
  body_md: string;
};

const FALLBACK = {
  title: "Slik sporer vi offentlig sektors AI-aktivitet",
  body_md: `/offentlig kobler to uavhengige datakilder for å vise hva norsk offentlig sektor faktisk gjør med kunstig intelligens — ikke bare hva som debatteres.

## Slik fungerer det

- **Stortinget (live nå).** Hver dag kl. 07:00 UTC henter vi alle saker fra den aktive parlamentariske sesjonen via [data.stortinget.no](https://data.stortinget.no). En nøkkelord-matcher flagger saker som handler om AI på tittelen og emnelisten.
- **Doffin (kommer).** Tilsvarende daglig poll mot Doffins offentlige API for kunngjøringer, tildelinger og endringer av offentlige anbud. Når DFØ aktiverer API-tilgangen vår, landrer denne halvdelen.
- **Tier 1 LLM.** Henter ut verbatim AI-uttrykk fra nye saker — *kun framoverbevegelse, ingen historiske saker*. Brukes for å vokse nøkkelord-katalogen.
- **Tier 2 LLM.** Tildeler kategorier fra en politikk-orientert taksonomi (AI-regulering, AI i helse, AI i forsvar osv.). Kjører på alle AI-flaggede saker, også de som ble backfilt før Tier 1 fantes.
- **Snapshot-refresh.** Kl. 05:00 UTC hver natt regner vi ut alle dashboardtallene på nytt.

## Hva er unikt med /offentlig?

De andre pilarene beskriver hva som *allerede har skjedd*: jobber utlyst, nyheter publisert, selskaper registrert. /offentlig fanger to ting ingen av de andre har:

1. **Politisk intensjon** — fra Stortinget. Hva ønsker man å gjøre med AI, og når?
2. **Konkret pengebruk** — fra Doffin (kommer). Hvilke byråer kjøper hva, og fra hvem?

Synergien mellom de to driver målinger som ingen enkeltkilde kan gi — som *median tid mellom et Stortinget-vedtak og første matchende Doffin-anbud* (politikk-til-innkjøp lag).`,
};

export const metadata: Metadata = {
  title: "Offentlig sektor-pipelinen — Dokumentasjon",
  description:
    "Slik fungerer /offentlig: parlamentariske saker fra Stortinget koblet med kommende AI-anskaffelser fra Doffin.",
  alternates: { canonical: "/docs/offentlig-sektor" },
};

export const revalidate = 60;

export default async function DocsOffentligPage() {
  const rows = await sb<SiteContent[]>(
    "/site_content?slug=eq.docs-offentlig&select=slug,title,body_md",
  ).catch(() => [] as SiteContent[]);

  const row = rows[0];
  const title = row?.title ?? FALLBACK.title;
  const body = row?.body_md ?? FALLBACK.body_md;

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
            <BreadcrumbPage>Offentlig sektor</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <h1 className="title">{title}</h1>

      {renderMarkdown(body)}

      <PipelineFlow
        ariaTitle="Dataflyt for /offentlig-pipelinen"
        idPrefix="diag-offentlig"
        steps={[
          "Stortinget API",
          "Daglig fetch",
          "Nøkkelord-tag",
          "Tier 1 LLM",
          "Tier 2 LLM",
          "/offentlig",
        ]}
        cadences={[
          "07:00 daglig",
          "ved ingest",
          "4× i timen",
          "4× i timen",
          "05:00 daglig",
        ]}
      />

      <details className="tech-stack">
        <summary>Tekniske detaljer</summary>
        <table className="tech-table">
          <tbody>
            <tr>
              <th>Kilde — Stortinget</th>
              <td>
                <code>data.stortinget.no/eksport/saker</code> og{" "}
                <code>/stortingsvedtak</code> per sesjon (JSON via{" "}
                <code>?format=json</code>)
              </td>
            </tr>
            <tr>
              <th>Daglig fetch</th>
              <td>
                <code>offentlig-storting-fetch</code> — 07:00 UTC, hele
                aktive sesjon
              </td>
            </tr>
            <tr>
              <th>Søndags-retag</th>
              <td>
                <code>offentlig-storting-retag</code> — søndager 04:15 UTC,
                re-applikerer nåværende nøkkelord-katalog
              </td>
            </tr>
            <tr>
              <th>Tier 1 LLM</th>
              <td>
                <code>offentlig-llm-tier1</code> — :03/:18/:33/:48, K=15
                rader/tick, forward-only på{" "}
                <code>ingest_mode=&apos;live&apos;</code>
              </td>
            </tr>
            <tr>
              <th>Tier 2 LLM</th>
              <td>
                <code>offentlig-llm-tier2</code> — :10/:25/:40/:55, K=4
                rader/tick, gates på <code>is_ai_relevant</code> (også
                backfill)
              </td>
            </tr>
            <tr>
              <th>Snapshot-refresh</th>
              <td>
                <code>offentlig-refresh-snapshots</code> — daglig 05:00 UTC
              </td>
            </tr>
            <tr>
              <th>Persistens</th>
              <td>
                <code>storting_saker</code>, <code>storting_vedtak</code>,{" "}
                <code>storting_categories</code>,{" "}
                <code>offentlig_snapshot_*</code>
              </td>
            </tr>
            <tr>
              <th>Datafloor</th>
              <td>
                2020-01-01 — sammenfaller med lanseringen av Norges
                nasjonale AI-strategi (januar 2020). Stortingets sesjon
                går oktober → september, så backfill starter ved
                sesjon 2019-2020 (som dekker hele kalenderåret 2020).
              </td>
            </tr>
            <tr>
              <th>Kilde — Doffin (venter)</th>
              <td>
                <code>dof-notices-prod-api.developer.azure-api.net</code>,
                eForms XML, aktivering via{" "}
                <code>ingunn.ostrem@dfo.no</code>
              </td>
            </tr>
          </tbody>
        </table>
      </details>
    </main>
  );
}
