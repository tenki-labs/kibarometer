// app/(site)/docs/media/page.tsx — operational docs for the media pipeline.
// Editable summary prose lives in public.site_content (slug = docs-media);
// the SVG flow diagram + "Tekniske detaljer" block are hardcoded JSX since
// they must track code (cron times, endpoints, table names).

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
  title: "Slik måler vi mediedekningen",
  body_md: `/media måler hvor ofte og hvor varmt norske medier omtaler kunstig intelligens. Vi sporer aktive nyhetskilder og publiserer en daglig dekkings-temperatur.

## Slik fungerer det

- **Oppdagelse.** Fire ganger i timen leser vi RSS-feedene til kildene våre.
- **Henting og parsing.** Tolv ganger i timen henter vi artikkel-HTMLen.
- **Tier 1 LLM (deteksjon).** En lokal språkmodell bekrefter relevans.
- **Tier 2 LLM (kategorisering).** AI-relevante artikler scores for *holdning* og *intensitet*.
- **Snapshot.** Kl. 04:30 hver natt regner vi ut alle dashboardtallene på nytt.`,
};

export const metadata: Metadata = {
  title: "Media-pipelinen — Dokumentasjon",
  description:
    "Slik fungerer kibarometerets media-pipeline: fra RSS-feed til dashboard.",
  alternates: { canonical: "/docs/media" },
};

export const revalidate = 60;

export default async function DocsMediaPage() {
  const rows = await sb<SiteContent[]>(
    "/site_content?slug=eq.docs-media&select=slug,title,body_md",
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
            <BreadcrumbPage>Media</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <h1 className="title">{title}</h1>

      {renderMarkdown(body)}

      <PipelineFlow
        ariaTitle="Dataflyt for media-pipelinen"
        idPrefix="diag-media"
        steps={[
          "RSS-feeds",
          "Oppdagelse",
          "Henting",
          "Tier 1 LLM",
          "Tier 2 LLM",
          "/media",
        ]}
        cadences={[
          "4× i timen",
          "12× i timen",
          "4× i timen",
          "4× i timen",
          "04:30 daglig",
        ]}
      />

      <details className="tech-stack">
        <summary>Tekniske detaljer</summary>
        <table className="tech-table">
          <tbody>
            <tr>
              <th>Kilde</th>
              <td>
                RSS-feeder fra norske mediehus (registrert i{" "}
                <code>media_sources</code>)
              </td>
            </tr>
            <tr>
              <th>Oppdagelse</th>
              <td>
                <code>media-discover</code> — :02/:17/:32/:47, RSS-poll +
                tittel/ingress-filter
              </td>
            </tr>
            <tr>
              <th>Henting + parsing</th>
              <td>
                <code>media-fetch-classify</code> — 12× i timen, K=20 rader/tick,
                simhash + wire-cluster
              </td>
            </tr>
            <tr>
              <th>Tier 1 LLM</th>
              <td>
                <code>media-llm-tier1</code> — :06/:21/:36/:51, K=15 rader/tick
              </td>
            </tr>
            <tr>
              <th>Tier 2 LLM</th>
              <td>
                <code>media-llm-tier2</code> — :13/:28/:43/:58, K=4 rader/tick
              </td>
            </tr>
            <tr>
              <th>Snapshot-refresh</th>
              <td>
                <code>media-refresh-snapshots</code> — daglig 04:30 UTC
              </td>
            </tr>
            <tr>
              <th>Persistens (kun metadata)</th>
              <td>
                <code>media_sources</code>, <code>media_url_queue</code>,{" "}
                <code>media_articles</code>, <code>media_snapshot_*</code>,{" "}
                <code>media_anomaly_daily</code>
              </td>
            </tr>
            <tr>
              <th>Etikk</th>
              <td>
                <code>robots.txt</code> respektert; per-kilde rate-limiting;
                brødtekst lagres aldri
              </td>
            </tr>
          </tbody>
        </table>
      </details>
    </main>
  );
}
