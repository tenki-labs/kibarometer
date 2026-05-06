// app/(site)/metode/page.tsx — methodology + keyword catalogue.
// The prose (lede, "hva AI-relatert betyr", "kjente begrensninger",
// "foreslå et nøkkelord") is editable via /admin/content/metode and read
// from public.site_content. The keyword catalogue + API/embed snippets
// stay JSX so they reflect live data, not editorial copy.

import { sb, type Keyword, type TaxonomyCategory } from "@/lib/supabase";
import { renderMarkdown } from "@/lib/admin/markdown";

type SiteContent = {
  slug: string;
  title: string;
  body_md: string;
};

const FALLBACK = {
  title: "Hvordan vi måler",
  body_md: `Kibarometeret leser [NAVs stillingsfeed](https://navikt.github.io/pam-stilling-feed/) og merker en stilling som *AI-relatert* hvis tittelen, beskrivelsen eller yrkesfeltet inneholder ett eller flere av begrepene i listen under. Listen er kuratert manuelt og redigeres åpent.

## Hva «AI-relatert» betyr

Vi bruker en inkluderingsliste av begreper på engelsk og norsk, fordelt på *verktøy* (PyTorch, OpenAI, Hugging Face …), *roller* (ML Engineer, Dataforsker …) og *konsepter* (machine learning, kunstig intelligens, RAG …). Ord-treff bruker unicode-bevisste ordgrenser slik at norske bokstaver (æ ø å) håndteres riktig.

En stilling regnes som AI-relatert dersom **minst ett** begrep treffer. Vi viser hvilke begreper som matchet på den enkelte radens lenke til denne siden.

## Kjente begrensninger

- **«transformer»** kan også bety krafttransformator. Vi overvåker falske positive ukentlig — meld fra hvis du ser noe rart.
- **Bare-akronymer som AI, KI, ML** er kraftige men støyete. NLP kan også bety nevro-lingvistisk programmering. Word-boundary-matching reduserer støy, men ikke fjerner den.
- **Recall avhenger av berikelse.** Stillinger får full tagging (tittel + beskrivelse) først etter at vi har hentet detaljpost fra NAV. Stillinger som er ferske og fortsatt i berikelseskøen merkes på tittel alene.
- **«Lavt utvalg»-merket** vises på rader med færre enn 10 AI-stillinger i vinduet. Andelene i Geografi er minst pålitelige for fylker med liten samlet stillingstilgang.

## Foreslå et nøkkelord

Saker mangler? Ord som ikke burde regnes som AI? [Åpne en issue på GitHub](https://github.com/tenki-labs/kibarometer/issues/new?template=keyword-suggestion.yml) — det er et strukturert skjema med felt for begrep, språk og eksempelutlysning. Alle endringer skjer åpent.`,
};

export const metadata = {
  title: "Metode — Kibarometeret",
  description:
    "Hvordan Kibarometeret avgjør hva som regnes som AI-relatert: full nøkkelordliste, kjente begrensninger og hvordan du foreslår nye termer.",
};

const CATEGORY_LABEL: Record<Keyword["category"], string> = {
  tool: "Verktøy",
  role: "Roller",
  concept: "Konsepter",
};

const CATEGORY_ORDER: Keyword["category"][] = ["tool", "role", "concept"];

export default async function MetodePage() {
  const [keywords, contentRows, taxonomy] = await Promise.all([
    sb<Keyword[]>(
      "/keywords?select=id,term,language,category,match_type,notes&order=category.asc,term.asc",
    ),
    sb<SiteContent[]>(
      "/site_content?slug=eq.metode&select=slug,title,body_md",
    ).catch(() => [] as SiteContent[]),
    sb<TaxonomyCategory[]>(
      "/taxonomy_categories?select=slug,title,definition_md,sort_order&order=sort_order.asc",
    ).catch(() => [] as TaxonomyCategory[]),
  ]);

  const content = contentRows[0];
  const title = content?.title ?? FALLBACK.title;
  const body = content?.body_md ?? FALLBACK.body_md;

  const grouped: Record<Keyword["category"], Keyword[]> = {
    tool: [],
    role: [],
    concept: [],
  };
  for (const k of keywords) {
    (grouped[k.category] ?? (grouped[k.category] = [])).push(k);
  }

  return (
    <main className="metode">
      <span className="eyebrow">· Metode</span>
      <h1 className="title">{title}</h1>

      {/* Editable prose. Keyword count interpolation has been removed —
          operators can mention the count manually if they want. */}
      {renderMarkdown(body)}

      {/* AI-skill taxonomy used by Tier 2 LLM classification. Read live from
          public.taxonomy_categories so retiring or editing a definition in
          /admin/job-market/categories shows up here without redeploy. Falls back to
          silence if the migration hasn't run yet (catch in the fetch). */}
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

      {/* Static technical sections: API, embeds, keyword catalogue. These
          mirror live state (keyword list comes from the DB) and aren't
          appropriate to edit as prose. */}
      <h2>API + embed</h2>
      <p>
        Snapshots eksponeres som JSON. Hver returnerer én rad med dagens tall:
      </p>
      <ul>
        <li><a href="/api/v1/headline">/api/v1/headline</a> — overskrifts-tallet</li>
        <li><a href="/api/v1/trend">/api/v1/trend</a> — månedlig trend</li>
        <li><a href="/api/v1/keywords">/api/v1/keywords</a> — toppliste</li>
        <li><a href="/api/v1/geography">/api/v1/geography</a> — fylkesfordeling</li>
        <li><a href="/api/v1/category">/api/v1/category</a> — yrkeskategori</li>
      </ul>
      <p>For artikkel-innbygging finnes minimalistiske visninger:</p>
      <pre style={{
        background: "var(--surface, #f0f0f0)",
        padding: "0.75rem 1rem",
        overflowX: "auto",
        fontSize: "0.85rem",
      }}>{`<iframe src="https://kibarometer.no/embed/headline"
        width="100%" height="180" frameborder="0"
        title="AI-stillinger denne uken"></iframe>

<iframe src="https://kibarometer.no/embed/trend"
        width="100%" height="320" frameborder="0"
        title="Trend i AI-stillinger"></iframe>`}</pre>

      <h2>Nøkkelordliste ({keywords.length})</h2>
      {CATEGORY_ORDER.map((cat) => {
        const list = grouped[cat] ?? [];
        if (list.length === 0) return null;
        return (
          <div key={cat} className="kw-cat-block">
            <h3 style={{ fontSize: "0.95rem", fontWeight: 500, margin: "1rem 0 0.5rem" }}>
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
                  <small style={{ marginLeft: "0.4rem", color: "var(--muted)" }}>
                    · {k.language}
                  </small>
                  {k.notes && <span className="kw-chip-note">{k.notes}</span>}
                </a>
              ))}
            </div>
          </div>
        );
      })}

      <p className="meta" style={{ marginTop: "3rem" }}>
        Kildekode:{" "}
        <a href="https://github.com/tenki-labs/kibarometer">
          tenki-labs/kibarometer
        </a>.
      </p>
    </main>
  );
}
