// app/(site)/docs/arbeidsmarked/page.tsx — operational docs for the NAV pipeline.
// Editable summary prose lives in public.site_content (slug = docs-jobbmarked);
// the SVG flow diagram + "Tekniske detaljer" block are hardcoded JSX since
// they must track code (cron times, endpoints, table names).

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

import { PipelineFlow } from "../_components/pipeline-flow";

type SiteContent = {
  slug: string;
  title: string;
  body_md: string;
};

export const metadata: Metadata = {
  title: "Arbeidsmarked-pipelinen — Dokumentasjon",
  description:
    "Slik fungerer kibarometerets arbeidsmarked-pipeline: fra NAV-feed til dashboard.",
  alternates: { canonical: "/docs/arbeidsmarked" },
};

export const dynamic = "force-dynamic";

export default async function DocsArbeidsmarkedPage() {
  const rows = await sb<SiteContent[]>(
    "/site_content?slug=eq.docs-jobbmarked&select=slug,title,body_md",
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
            <BreadcrumbPage>Arbeidsmarked</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <h1 className="title">{title}</h1>

      {renderMarkdown(body)}

      <PipelineFlow
        ariaTitle="Dataflyt for arbeidsmarked-pipelinen"
        idPrefix="diag-arbeidsmarked"
        steps={[
          "NAV API",
          "Henting",
          "Berikelse",
          "Tier 1 LLM",
          "Tier 2 LLM",
          "/arbeidsmarked",
        ]}
        cadences={[
          "06:00 daglig",
          "4× i timen",
          "4× i timen",
          "4× i timen",
          "04:00 daglig",
        ]}
      />

      <details className="tech-stack">
        <summary>Tekniske detaljer</summary>
        <table className="tech-table">
          <tbody>
            <tr>
              <th>Kilde</th>
              <td>
                <a href="https://pam-stilling-feed.nav.no/api/v1/feed">
                  pam-stilling-feed.nav.no/api/v1/feed
                </a>{" "}
                (NAV Stillingsfeed)
              </td>
            </tr>
            <tr>
              <th>Henting</th>
              <td>
                <code>backfill-nav</code> — daglig 06:00 UTC
              </td>
            </tr>
            <tr>
              <th>Berikelse</th>
              <td>
                <code>enrich-nav</code> — :05/:20/:35/:50 hver time
              </td>
            </tr>
            <tr>
              <th>Tier 1 LLM (deteksjon)</th>
              <td>
                <code>llm-discover</code> — :08/:23/:38/:53, Gemma 3 4B-IT,
                K=15 rader/tick
              </td>
            </tr>
            <tr>
              <th>Tier 2 LLM (kategorisering)</th>
              <td>
                <code>llm-classify</code> — :11/:26/:41/:56, K=4 rader/tick
              </td>
            </tr>
            <tr>
              <th>Snapshot-refresh</th>
              <td>
                <code>refresh-snapshots</code> — daglig 04:00 UTC, oppdaterer
                seks dashboardtabeller
              </td>
            </tr>
            <tr>
              <th>Persistens</th>
              <td>
                <code>nav_raw</code>, <code>nav_postings</code>,{" "}
                <code>snapshot_headline</code>, <code>snapshot_keywords</code>,{" "}
                <code>snapshot_geography</code>,{" "}
                <code>snapshot_category_daily</code>,{" "}
                <code>snapshot_skill_category_daily</code>
              </td>
            </tr>
            <tr>
              <th>Offentlig API</th>
              <td>
                <a href="/api/v1/headline">/api/v1/headline</a>,{" "}
                <a href="/api/v1/trend">/api/v1/trend</a>,{" "}
                <a href="/api/v1/keywords">/api/v1/keywords</a>,{" "}
                <a href="/api/v1/geography">/api/v1/geography</a>,{" "}
                <a href="/api/v1/category">/api/v1/category</a>
              </td>
            </tr>
          </tbody>
        </table>
      </details>
    </main>
  );
}
