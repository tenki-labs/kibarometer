import type { Metadata } from "next";
import Link from "next/link";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  title: { absolute: "kibarometer" },
  description: "Et uavhengig barometer for norsk arbeidsmarked.",
  alternates: { canonical: "/" },
  openGraph: {
    url: "/",
    title: "kibarometer",
    description: "Et uavhengig barometer for norsk arbeidsmarked.",
  },
};

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

export default function LandingPage() {
  return (
    <main className="flex min-h-[calc(100svh-3.5rem)] items-center justify-center px-6">
      <div className="max-w-xl text-center">
        <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">
          Et uavhengig barometer for norsk arbeidsmarked.
        </h1>
        <p className="mt-6 text-sm text-muted-foreground">
          Daglig oppdaterte tall basert på NAVs stillingsfeed.
        </p>
        <Link
          href="/jobbmarked"
          className="mt-10 inline-block font-mono text-xs uppercase tracking-[0.22em] text-foreground underline-offset-4 hover:underline"
        >
          Se jobbmarkedet →
        </Link>
      </div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </main>
  );
}
