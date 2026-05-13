// app/(site)/docs/page.tsx — landing for the /docs section. Five doc-section
// cards (one per pipeline + nokkelord + api), then an editable "Sammendrag"
// markdown section sourced from public.site_content (slug = docs).

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
  title: "Dokumentasjon — Kibarometeret",
  description:
    "Slik fungerer hver av kibarometerets datapipeliner — fra kilde til dashboard.",
  alternates: { canonical: "/docs" },
};

export const dynamic = "force-dynamic";

const DOC_SECTIONS = [
  {
    href: "/docs/arbeidsmarked",
    title: "Arbeidsmarked",
    description: "AI-stillinger fra NAVs offentlige stillingsfeed.",
  },
  {
    href: "/docs/oppstart",
    title: "Oppstart",
    description: "Nye AI-selskaper fra Brønnøysundregistrene.",
  },
  {
    href: "/docs/media",
    title: "Media",
    description: "AI-dekning i norske medier, hentet fra RSS-feeder.",
  },
  {
    href: "/docs/offentlig-sektor",
    title: "Offentlig sektor",
    description:
      "Parlamentariske saker fra Stortinget + kommende AI-anskaffelser fra Doffin.",
  },
  {
    href: "/docs/nokkelord",
    title: "Nøkkelord",
    description: "Nøkkelordliste, AI-ferdighetskategorier og medie-kilder.",
  },
  {
    href: "/docs/api",
    title: "API",
    description: "JSON-endepunkter og iframe-embed-snippets.",
  },
];

export default async function DocsIndexPage() {
  const rows = await sb<SiteContent[]>(
    "/site_content?slug=eq.docs&select=slug,title,body_md",
  );

  const row = rows[0];
  if (!row) notFound();
  const { title: summaryTitle, body_md: summaryBody } = row;

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
            <BreadcrumbPage>Dokumentasjon</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <h1 className="title">Dokumentasjon</h1>
      <p>
        Slik fungerer hver av kibarometerets datapipeliner — fra kilde til
        dashboard.
      </p>

      <ul className="docs-index">
        {DOC_SECTIONS.map((s) => (
          <li key={s.href}>
            <Link href={s.href} className="docs-index-card">
              <span className="docs-index-card-title">{s.title}</span>
              <span className="docs-index-card-desc">{s.description}</span>
              <span className="docs-index-card-arrow" aria-hidden="true">
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <h2 style={{ marginTop: "2.5rem" }}>{summaryTitle}</h2>
      {renderMarkdown(summaryBody)}
    </main>
  );
}
