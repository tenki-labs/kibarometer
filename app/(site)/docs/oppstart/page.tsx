// app/(site)/docs/oppstart/page.tsx — operational docs for the BRREG pipeline.
// Editable summary prose lives in public.site_content (slug = docs-oppstart);
// the SVG flow diagram + "Tekniske detaljer" block are hardcoded JSX since
// they must track code (cron times, endpoints, table names).

import Link from "next/link";
import type { Metadata } from "next";

import { sb } from "@/lib/supabase";
import { renderMarkdown } from "@/lib/admin/markdown";

import { PipelineFlow } from "../_components/pipeline-flow";

type SiteContent = {
  slug: string;
  title: string;
  body_md: string;
};

const FALLBACK = {
  title: "Slik måler vi nye AI-selskaper",
  body_md: `/oppstart teller nyregistrerte norske foretak som driver med AI eller AI-tilstøtende virksomhet. Data hentes fra [Brønnøysundregistrene](https://www.brreg.no/) sin Enhetsregister-API.

## Slik fungerer det

- **Daglig innhenting.** Hver morgen kl. 06:30 henter vi alle foretak registrert dagen før.
- **Rolle-berikelse.** To ganger i timen henter vi rolleinnehavere.
- **Tier 1 LLM (deteksjon).** En lokal språkmodell avgjør om foretaket faktisk driver med AI.
- **Tier 2 LLM (kategorisering).** AI-foretak klassifiseres i kategorier.
- **Snapshot.** Kl. 04:45 hver natt regner vi ut alle dashboardtallene på nytt.`,
};

export const metadata: Metadata = {
  title: "Oppstart-pipelinen — Dokumentasjon",
  description:
    "Slik fungerer kibarometerets oppstart-pipeline: fra Brønnøysundregistrene til dashboard.",
  alternates: { canonical: "/docs/oppstart" },
};

export const revalidate = 60;

export default async function DocsOppstartPage() {
  const rows = await sb<SiteContent[]>(
    "/site_content?slug=eq.docs-oppstart&select=slug,title,body_md",
  ).catch(() => [] as SiteContent[]);

  const row = rows[0];
  const title = row?.title ?? FALLBACK.title;
  const body = row?.body_md ?? FALLBACK.body_md;

  return (
    <main className="metode">
      <h1 className="title">{title}</h1>

      {renderMarkdown(body)}

      <PipelineFlow
        ariaTitle="Dataflyt for oppstart-pipelinen"
        idPrefix="diag-oppstart"
        steps={[
          "brreg API",
          "Innhenting",
          "Roller",
          "Tier 1 LLM",
          "Tier 2 LLM",
          "/oppstart",
        ]}
        cadences={[
          "06:30 daglig",
          "2× i timen",
          "4× i timen",
          "4× i timen",
          "04:45 daglig",
        ]}
      />

      <details className="tech-stack">
        <summary>Tekniske detaljer</summary>
        <table className="tech-table">
          <tbody>
            <tr>
              <th>Kilde</th>
              <td>
                <a href="https://data.brreg.no/enhetsregisteret/api">
                  data.brreg.no/enhetsregisteret/api
                </a>{" "}
                (Enhetsregisteret + Roller)
              </td>
            </tr>
            <tr>
              <th>Innhenting</th>
              <td>
                <code>brreg-ingest</code> — daglig 06:30 UTC
              </td>
            </tr>
            <tr>
              <th>Rolle-berikelse</th>
              <td>
                <code>brreg-roles</code> — :12/:42 hver time, K=50 rader/tick
              </td>
            </tr>
            <tr>
              <th>Tier 1 LLM</th>
              <td>
                <code>brreg-llm-tier1</code> — :01/:16/:31/:46, K=15 rader/tick
              </td>
            </tr>
            <tr>
              <th>Tier 2 LLM</th>
              <td>
                <code>brreg-llm-tier2</code> — :07/:22/:37/:52, K=4 rader/tick
              </td>
            </tr>
            <tr>
              <th>Snapshot-refresh</th>
              <td>
                <code>brreg-refresh-snapshots</code> — daglig 04:45 UTC
              </td>
            </tr>
            <tr>
              <th>Persistens</th>
              <td>
                <code>brreg_companies</code>, <code>brreg_roles</code>,{" "}
                <code>brreg_url_queue</code>, <code>nace_categories</code>,{" "}
                <code>brreg_snapshot_*</code>
              </td>
            </tr>
            <tr>
              <th>Politeness</th>
              <td>
                ~4 req/sek mot brreg, eksponentiell back-off ved feil
              </td>
            </tr>
          </tbody>
        </table>
      </details>

      <p className="meta" style={{ marginTop: "2.5rem" }}>
        <Link href="/oppstart">← Tilbake til Oppstart</Link>
      </p>
    </main>
  );
}
