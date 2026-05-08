// app/(site)/docs/page.tsx — landing for the /docs section. Three pipeline
// cards, then an editable "Sammendrag" markdown section sourced from
// public.site_content (slug = docs), then footer links to /docs/nokkelord
// and /docs/api.

import Link from "next/link";
import type { Metadata } from "next";

import { sb } from "@/lib/supabase";
import { renderMarkdown } from "@/lib/admin/markdown";

type SiteContent = {
  slug: string;
  title: string;
  body_md: string;
};

const FALLBACK = {
  title: "Sammendrag",
  body_md: `Kibarometeret er et uavhengig dashbord som sporer hvordan kunstig intelligens påvirker norsk arbeidsliv, mediebilde og næringsetablering. Tre datapipeliner mater dashboardene: [NAVs stillingsfeed](/docs/jobbmarked), [RSS-feeder fra norske medier](/docs/media), og [Brønnøysundregistrene](/docs/oppstart).

Hver pipeline har sin egen klassifiseringslogikk og kjente begrensninger — klikk på et av kortene over for å lese hvordan den enkelte fungerer.`,
};

export const metadata: Metadata = {
  title: "Dokumentasjon — Kibarometeret",
  description:
    "Slik fungerer hver av kibarometerets datapipeliner — fra kilde til dashboard.",
  alternates: { canonical: "/docs" },
};

export const revalidate = 60;

const PIPELINES = [
  {
    href: "/docs/jobbmarked",
    title: "Jobbmarked",
    description: "AI-stillinger fra NAVs offentlige stillingsfeed.",
  },
  {
    href: "/docs/media",
    title: "Media",
    description: "AI-dekning i norske medier, hentet fra RSS-feeder.",
  },
  {
    href: "/docs/oppstart",
    title: "Oppstart",
    description: "Nye AI-selskaper fra Brønnøysundregistrene.",
  },
];

export default async function DocsIndexPage() {
  const rows = await sb<SiteContent[]>(
    "/site_content?slug=eq.docs&select=slug,title,body_md",
  ).catch(() => [] as SiteContent[]);

  const row = rows[0];
  const summaryTitle = row?.title ?? FALLBACK.title;
  const summaryBody = row?.body_md ?? FALLBACK.body_md;

  return (
    <main className="metode">
      <h1 className="title">Dokumentasjon</h1>
      <p>
        Slik fungerer hver av kibarometerets datapipeliner — fra kilde til
        dashboard.
      </p>

      <ul className="docs-index">
        {PIPELINES.map((p) => (
          <li key={p.href}>
            <Link href={p.href} className="docs-index-card">
              <span className="docs-index-card-title">{p.title}</span>
              <span className="docs-index-card-desc">{p.description}</span>
              <span className="docs-index-card-arrow" aria-hidden="true">
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <h2 style={{ marginTop: "2.5rem" }}>{summaryTitle}</h2>
      {renderMarkdown(summaryBody)}

      <p className="meta" style={{ marginTop: "2.5rem" }}>
        Se også <Link href="/docs/nokkelord">/docs/nokkelord</Link> for
        nøkkelordliste, AI-ferdighetskategorier og medie-kilder, og{" "}
        <Link href="/docs/api">/docs/api</Link> for API- og embed-snippets.
      </p>
    </main>
  );
}
