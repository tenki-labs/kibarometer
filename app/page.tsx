const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "Tenki Labs",
      url: "https://tenki.no",
      logo: `${SITE_URL}/icon`,
      founder: {
        "@type": "Person",
        name: "Oscar Gangstad Westbye",
        url: "https://tenki.no",
      },
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: "Kibarometeret",
      inLanguage: "nb-NO",
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
  ],
};

export default function HomePage() {
  return (
    <main className="wrap">
      <span className="eyebrow">· kibarometer</span>
      <h1 className="title">Norsk arbeidsmarked, daglig oppdatert.</h1>
      <p className="lede">
        Kibarometeret henter rådata fra NAVs stillingsfeed, kjører vår egen
        analyse, og publiserer tall journalister kan sitere. Mer kommer.
      </p>
      <p className="meta">
        Datakilde:{" "}
        <a href="https://arbeidsplassen.nav.no/">NAV arbeidsplassen</a>. Metode
        og kildekode publiseres når sidene går live.
      </p>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </main>
  );
}
