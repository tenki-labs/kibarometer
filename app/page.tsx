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
    </main>
  );
}
