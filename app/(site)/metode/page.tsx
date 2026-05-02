// app/metode/page.tsx — methodology / keyword catalogue.
// Server component. Reads the live keyword list (anon key, RLS filters to
// is_active = true), so this page can never drift from what's actually applied.

import { sb, type Keyword } from "@/lib/supabase";

export const metadata = {
  title: "Metode — Kibarometeret",
  description:
    "Hvordan Kibarometeret avgjør hva som regnes som AI-relatert: full nøkkelordliste, kjente begrensninger og hvordan du foreslår nye termer.",
};

const ISSUE_URL =
  "https://github.com/tenki-labs/kibarometer/issues/new?template=keyword-suggestion.yml";

const CATEGORY_LABEL: Record<Keyword["category"], string> = {
  tool: "Verktøy",
  role: "Roller",
  concept: "Konsepter",
};

const CATEGORY_ORDER: Keyword["category"][] = ["tool", "role", "concept"];

export default async function MetodePage() {
  const keywords = await sb<Keyword[]>(
    "/keywords?select=id,term,language,category,match_type,notes&order=category.asc,term.asc",
  );

  const grouped: Record<Keyword["category"], Keyword[]> = {
    tool: [], role: [], concept: [],
  };
  for (const k of keywords) {
    (grouped[k.category] ?? (grouped[k.category] = [])).push(k);
  }

  return (
    <main className="metode">
      <span className="eyebrow">· Metode</span>
      <h1 className="title">Hvordan vi måler</h1>

      <p className="lede">
        Kibarometeret leser{" "}
        <a href="https://navikt.github.io/pam-stilling-feed/">
          NAVs stillingsfeed
        </a>{" "}
        og merker en stilling som <em>AI-relatert</em> hvis tittelen,
        beskrivelsen eller yrkesfeltet inneholder ett eller flere av begrepene
        i listen under. Listen er kuratert manuelt og redigeres åpent.
      </p>

      <h2>Hva «AI-relatert» betyr</h2>
      <p>
        Vi bruker en inkluderingsliste av rundt {keywords.length} begreper på
        engelsk og norsk, fordelt på <em>verktøy</em> (PyTorch, OpenAI,
        Hugging Face …), <em>roller</em> (ML Engineer, Dataforsker …) og{" "}
        <em>konsepter</em> (machine learning, kunstig intelligens, RAG …).
        Ord-treff bruker unicode-bevisste ordgrenser slik at norske bokstaver
        (æ ø å) håndteres riktig.
      </p>
      <p>
        En stilling regnes som AI-relatert dersom <strong>minst ett</strong>{" "}
        begrep treffer. Vi viser hvilke begreper som matchet på den enkelte
        radens lenke til denne siden.
      </p>

      <h2>Kjente begrensninger</h2>
      <ul>
        <li>
          <strong>«transformer»</strong> kan også bety krafttransformator. Vi
          overvåker falske positive ukentlig — meld fra hvis du ser noe rart.
        </li>
        <li>
          <strong>Bare-akronymer som AI, KI, ML</strong> er kraftige men
          støyete. <code>NLP</code> kan også bety nevro-lingvistisk
          programmering. Word-boundary-matching reduserer støy, men ikke
          fjerner den.
        </li>
        <li>
          <strong>Recall avhenger av berikelse.</strong> Stillinger får full
          tagging (tittel + beskrivelse) først etter at vi har hentet
          detaljpost fra NAV. Stillinger som er ferske og fortsatt i
          berikelseskøen merkes på tittel alene.
        </li>
        <li>
          <strong>«Lavt utvalg»-merket</strong> vises på rader med færre enn
          10 AI-stillinger i vinduet. Andelene i Geografi er minst pålitelige
          for fylker med liten samlet stillingstilgang.
        </li>
      </ul>

      <h2>Foreslå et nøkkelord</h2>
      <p>
        Saker mangler? Ord som ikke burde regnes som AI?{" "}
        <a href={ISSUE_URL}>Åpne en issue på GitHub</a> — det er et strukturert
        skjema med felt for begrep, språk og eksempelutlysning. Alle endringer
        skjer åpent.
      </p>

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
      <p>
        For artikkel-innbygging finnes minimalistiske visninger:
      </p>
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

      <h2>Nøkkelordliste</h2>
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
