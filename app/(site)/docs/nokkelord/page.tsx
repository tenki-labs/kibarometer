// app/(site)/docs/nokkelord/page.tsx — live lists used by the keyword-filtering
// pipelines: NAV keyword catalogue, AI-skill taxonomy, and active media-source
// catalogue. All three render directly from their source tables so editing the
// admin (e.g. /admin/keywords, /admin/job-market/categories, /admin/media/sources)
// reflects here without redeploy.
//
// This page is the destination for deep links from the /jobbmarked dashboard:
// keyword chips link to #kw-<term>, category bars link to #cat-<slug>.

import Link from "next/link";
import type { Metadata } from "next";

import {
  sb,
  type Keyword,
  type TaxonomyCategory,
} from "@/lib/supabase";

type MediaSource = {
  name: string;
  domain: string;
  category: string | null;
};

const CATEGORY_LABEL: Record<Keyword["category"], string> = {
  tool: "Verktøy",
  role: "Roller",
  concept: "Konsepter",
};

const CATEGORY_ORDER: Keyword["category"][] = ["tool", "role", "concept"];

const SOURCE_CATEGORY_LABEL: Record<string, string> = {
  mainstream: "Mainstream daglig/ukentlig",
  tech: "Tech / IT-presse",
  business: "Næringsliv / finans",
  policy: "Politikk / spesialist",
  other: "Annet",
};

const SOURCE_CATEGORY_ORDER = [
  "mainstream",
  "tech",
  "business",
  "policy",
  "other",
];

export const metadata: Metadata = {
  title: "Nøkkelord, kategorier og kilder — Dokumentasjon",
  description:
    "Levende lister fra kibarometerets klassifiserings-pipeliner: nøkkelord, AI-ferdighetskategorier og aktive medie-kilder.",
  alternates: { canonical: "/docs/nokkelord" },
};

export const revalidate = 60;

export default async function NokkelordPage() {
  const [keywords, taxonomy, mediaSources] = await Promise.all([
    sb<Keyword[]>(
      "/keywords?select=id,term,language,category,match_type,notes&order=category.asc,term.asc",
    ),
    sb<TaxonomyCategory[]>(
      "/taxonomy_categories?select=slug,title,definition_md,sort_order&order=sort_order.asc",
    ).catch(() => [] as TaxonomyCategory[]),
    sb<MediaSource[]>(
      "/media_sources?is_active=is.true&select=name,domain,category&order=name.asc",
    ).catch(() => [] as MediaSource[]),
  ]);

  const grouped: Record<Keyword["category"], Keyword[]> = {
    tool: [],
    role: [],
    concept: [],
  };
  for (const k of keywords) {
    (grouped[k.category] ?? (grouped[k.category] = [])).push(k);
  }

  const sourcesByCategory: Record<string, MediaSource[]> = {};
  for (const s of mediaSources) {
    const key = s.category ?? "other";
    (sourcesByCategory[key] ??= []).push(s);
  }

  return (
    <main className="metode">
      <h1 className="title">Nøkkelord, kategorier og kilder</h1>
      <p>
        Levende lister fra kibarometerets klassifiserings-pipeliner. Disse
        oppdateres automatisk når en operatør endrer dem i admin.
      </p>

      {taxonomy.length > 0 && (
        <>
          <h2 id="taksonomi">AI-ferdighetskategorier</h2>
          <p>
            For AI-relaterte stillinger forsøker vi i tillegg å klassifisere{" "}
            <em>hvilken type</em> AI-ferdighet som etterspørres. Klassifiseringen
            gjøres av en lokal språkmodell (Gemma 3) — én stilling kan tilhøre
            flere kategorier samtidig.
          </p>
          <dl className="taxonomy-list">
            {taxonomy.map((c) => (
              <div key={c.slug} id={`cat-${encodeURIComponent(c.slug)}`}>
                <dt>{c.title}</dt>
                <dd>{c.definition_md}</dd>
              </div>
            ))}
          </dl>
        </>
      )}

      <h2>Nøkkelordliste ({keywords.length})</h2>
      <p>
        Stillinger merkes som AI-relaterte når minst ett av begrepene under
        treffer i tittel eller fulltekst. Listen er kuratert manuelt og endres
        åpent — foreslå nye via{" "}
        <a href="https://github.com/tenki-labs/kibarometer/issues/new?template=keyword-suggestion.yml">
          GitHub-issues
        </a>
        .
      </p>
      {CATEGORY_ORDER.map((cat) => {
        const list = grouped[cat] ?? [];
        if (list.length === 0) return null;
        return (
          <div key={cat} className="kw-cat-block">
            <h3
              style={{
                fontSize: "0.95rem",
                fontWeight: 500,
                margin: "1rem 0 0.5rem",
              }}
            >
              {CATEGORY_LABEL[cat]}
            </h3>
            <div className="kw-grid">
              {list.map((k) => (
                <a
                  key={k.id}
                  id={`kw-${encodeURIComponent(k.term)}`}
                  className="kw-chip"
                  href={`#kw-${encodeURIComponent(k.term)}`}
                  title={k.notes ?? undefined}
                >
                  {k.term}
                  <small
                    style={{ marginLeft: "0.4rem", color: "var(--muted)" }}
                  >
                    · {k.language}
                  </small>
                  {k.notes && <span className="kw-chip-note">{k.notes}</span>}
                </a>
              ))}
            </div>
          </div>
        );
      })}

      {mediaSources.length > 0 && (
        <>
          <h2 id="kilder">Medie-kilder ({mediaSources.length})</h2>
          <p>
            Kibarometeret følger redaksjonelt innhold fra norske medieoutletter
            for å måle AI-dekning. Listen under viser hvilke kilder som er
            aktive i dag, gruppert etter type. Aktivering skjer manuelt — vi
            legger ikke til outletter automatisk uten redaksjonell vurdering.
          </p>
          {SOURCE_CATEGORY_ORDER.map((cat) => {
            const list = sourcesByCategory[cat];
            if (!list || list.length === 0) return null;
            return (
              <div key={cat} className="kw-cat-block">
                <h3
                  style={{
                    fontSize: "0.95rem",
                    fontWeight: 500,
                    margin: "1rem 0 0.5rem",
                  }}
                >
                  {SOURCE_CATEGORY_LABEL[cat] ?? cat} ({list.length})
                </h3>
                <div className="kw-grid">
                  {list.map((s) => (
                    <span key={s.domain} className="kw-chip" title={s.domain}>
                      {s.name}
                      <small
                        style={{ marginLeft: "0.4rem", color: "var(--muted)" }}
                      >
                        · {s.domain}
                      </small>
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </>
      )}

      <p className="meta" style={{ marginTop: "2.5rem" }}>
        <Link href="/docs">← Tilbake til Dokumentasjon</Link>
      </p>
    </main>
  );
}
