// app/(site)/docs/page.tsx — landing for the /docs section. Three cards,
// one per pipeline. Hardcoded copy: this page is just a router, not editorial
// surface, so it does not read from site_content.

import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dokumentasjon — Kibarometeret",
  description:
    "Slik fungerer hver av kibarometerets datapipeliner — fra kilde til dashboard.",
  alternates: { canonical: "/docs" },
};

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

export default function DocsIndexPage() {
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

      <p className="meta" style={{ marginTop: "3rem" }}>
        For den meta-metodiske diskusjonen om hva «AI-relatert» betyr, se{" "}
        <Link href="/metode">/metode</Link>.
      </p>
    </main>
  );
}
