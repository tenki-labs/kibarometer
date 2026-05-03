import Link from "next/link";

export const metadata = {
  title: "Media-barometer — Kibarometeret",
  description:
    "Hvordan norske medier dekker AI i arbeidsmarkedet. Kommer snart.",
};

export default function MediaPage() {
  return (
    <main className="metode">
      <span className="eyebrow">· Media-barometer</span>
      <h1 className="title">Media-barometer</h1>
      <p className="lede">
        En oversikt over hvordan norske medier dekker AI i arbeidsmarkedet
        kommer snart.
      </p>
      <p className="meta">
        I mellomtiden, se{" "}
        <Link href="/">Jobb-barometeret</Link> for daglig oppdaterte tall fra
        NAVs stillingsfeed.
      </p>
    </main>
  );
}
