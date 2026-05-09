// app/(site)/docs/api/page.tsx — API + embed snippets, fully hardcoded JSX.
// Lists the public JSON endpoints and the iframe embed snippets for
// journalists who want to cite or embed kibarometer numbers.

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

export const metadata: Metadata = {
  title: "API + embed — Dokumentasjon",
  description:
    "Kibarometerets offentlige JSON-API og iframe-embeds for journalister og utviklere.",
  alternates: { canonical: "/docs/api" },
};

const EMBED_SNIPPETS = `<iframe src="https://kibarometer.no/embed/headline"
        width="100%" height="180" frameborder="0"
        title="AI-stillinger denne uken"></iframe>

<iframe src="https://kibarometer.no/embed/trend"
        width="100%" height="320" frameborder="0"
        title="Trend i AI-stillinger"></iframe>`;

export default function ApiDocsPage() {
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
            <BreadcrumbPage>API</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <h1 className="title">API + embed</h1>

      <h2>JSON-snapshots</h2>
      <p>
        Snapshots eksponeres som JSON. Hver returnerer én rad med dagens tall:
      </p>
      <ul>
        <li>
          <a href="/api/v1/headline">/api/v1/headline</a> — overskrifts-tallet
        </li>
        <li>
          <a href="/api/v1/trend">/api/v1/trend</a> — månedlig trend
        </li>
        <li>
          <a href="/api/v1/keywords">/api/v1/keywords</a> — toppliste
        </li>
        <li>
          <a href="/api/v1/geography">/api/v1/geography</a> — fylkesfordeling
        </li>
        <li>
          <a href="/api/v1/category">/api/v1/category</a> — yrkeskategori
        </li>
      </ul>

      <h2>Iframe-embeds</h2>
      <p>For artikkel-innbygging finnes minimalistiske visninger:</p>
      <pre
        style={{
          background: "var(--surface, #f0f0f0)",
          padding: "0.75rem 1rem",
          overflowX: "auto",
          fontSize: "0.85rem",
        }}
      >
        {EMBED_SNIPPETS}
      </pre>

    </main>
  );
}
