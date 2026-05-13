// Card listing the sections that ship once the Doffin half of /offentlig
// is online. Rendered as the final scroll segment in storting-only MVP so
// the page tells visitors what's missing rather than implying "this is
// everything".

const PLANNED = [
  {
    title: "AI-anskaffelser over tid",
    blurb:
      "Kumulativ NOK forpliktet til AI av norsk offentlig sektor — fra Doffin.",
  },
  {
    title: "News → policy → spend resonans",
    blurb:
      "Tre normaliserte linjer på samme tidsakse: medieintensitet, parlamentsdebatt, faktisk innkjøp. Etterslepet mellom bølgene er historien.",
  },
  {
    title: "Politikk-til-innkjøp lag",
    blurb:
      "Median tid mellom et Stortinget-vedtak og første matchende Doffin-anbud, per kategori.",
  },
  {
    title: "Bottom-up vs top-down",
    blurb:
      "Andel av AI-spend som går til kommune / fylke / staten over tid.",
  },
  {
    title: "Overraskende innkjøp",
    blurb:
      "Kjøpere som plutselig kjøper noe utenfor sin vanlige CPV-historikk — den lille kommunen som tester en LLM-chatbot.",
  },
];

export function ComingSoon() {
  return (
    <div className="flex h-full w-full flex-col justify-center gap-6 px-4 py-10 sm:px-8">
      <div className="max-w-2xl">
        <p className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Kommer
        </p>
        <h2 className="mt-2 text-2xl font-medium leading-tight tracking-tight sm:text-3xl">
          Doffin-halvdelen lander når DFØ aktiverer API-tilgangen
        </h2>
        <p className="mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
          Stortinget gir oss <em>politisk intensjon</em> — Doffin vil gi oss{" "}
          <em>faktiske innkjøp</em>. Når begge halvdelene er online, vises
          disse fem ekstra segmentene:
        </p>
      </div>

      <ul className="grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
        {PLANNED.map((s) => (
          <li
            key={s.title}
            className="rounded-md border border-dashed border-muted-foreground/30 p-4"
          >
            <h3 className="text-sm font-medium">{s.title}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{s.blurb}</p>
          </li>
        ))}
      </ul>

      <p className="max-w-xl text-xs text-muted-foreground">
        Lurer du på hvordan dette er bygget? Les{" "}
        <a
          href="/docs/offentlig-sektor"
          className="underline decoration-dotted underline-offset-4"
        >
          metode-dokumentet
        </a>
        .
      </p>
    </div>
  );
}
