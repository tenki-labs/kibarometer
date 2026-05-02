// app/om/page.tsx — about page. Static.

export const metadata = {
  title: "Om — Kibarometeret",
  description:
    "Kibarometeret er et uavhengig dashbord fra Tenki Labs som sporer AI-relaterte stillinger i norsk arbeidsmarked.",
};

export default function OmPage() {
  return (
    <main className="metode">
      <span className="eyebrow">· Om</span>
      <h1 className="title">Om Kibarometeret</h1>

      <p className="lede">
        Kibarometeret er et uavhengig dashbord som sporer AI-relaterte
        stillinger i norsk arbeidsmarked. Vi henter rådata fra NAVs offentlige
        stillingsfeed, kjører vår egen analyse og publiserer tall journalister
        kan sitere.
      </p>

      <h2>Hvem står bak</h2>
      <p>
        Kibarometeret drives av <a href="https://tenki.no">Tenki Labs</a>,
        ansvarlig redaktør og forfatter er Oscar Gangstad Westbye.
      </p>

      <h2>Kontakt</h2>
      <p>
        Spørsmål om metodikk, sitering eller potensielle feil:{" "}
        <a href="mailto:oscar@tenki.no">oscar@tenki.no</a>.{" "}
        For tekniske bidrag eller forslag til nøkkelord, bruk{" "}
        <a href="https://github.com/tenki-labs/kibarometer/issues">
          GitHub-issues
        </a>.
      </p>

      <h2>Sitering</h2>
      <p>
        Tallene er gratis å bruke i nyhets- og forskningsøyemed. Vi setter pris
        på en kreditering til <em>Kibarometeret / Tenki Labs</em> og en lenke
        til kibarometer.no eller den dato-pinnede permalinken
        (<code>?as_of=ÅÅÅÅ-MM-DD</code>).
      </p>
    </main>
  );
}
