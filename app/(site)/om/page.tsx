// app/(site)/om/page.tsx — about page. Title + body sourced from the
// public.site_content table (slug = 'om') so an admin can edit copy on
// /admin/content/om without redeploying. Falls back to a hardcoded copy if
// the row is missing (build-time prerender, fresh install before the seed
// has run, etc.) so the page never breaks.

import { sb } from "@/lib/supabase";
import { renderMarkdown } from "@/lib/admin/markdown";

type SiteContent = {
  slug: string;
  title: string;
  body_md: string;
};

const FALLBACK = {
  title: "Om Kibarometeret",
  body_md: `Kibarometeret er et uavhengig dashbord som sporer AI-relaterte stillinger i norsk arbeidsmarked. Vi henter rådata fra NAVs offentlige stillingsfeed, kjører vår egen analyse og publiserer tall journalister kan sitere.

## Hvem står bak

Kibarometeret drives av [Tenki Labs](https://tenki.no), ansvarlig redaktør og forfatter er Oscar Gangstad Westbye.

## Kontakt

Spørsmål om metodikk, sitering eller potensielle feil: [oscar@tenki.no](mailto:oscar@tenki.no). For tekniske bidrag eller forslag til nøkkelord, bruk [GitHub-issues](https://github.com/tenki-labs/kibarometer/issues).

## Sitering

Tallene er gratis å bruke i nyhets- og forskningsøyemed. Vi setter pris på en kreditering til *Kibarometeret / Tenki Labs* og en lenke til kibarometer.no eller den dato-pinnede permalinken (\`?as_of=ÅÅÅÅ-MM-DD\`).`,
};

export const metadata = {
  title: "Om — Kibarometeret",
  description:
    "Kibarometeret er et uavhengig dashbord fra Tenki Labs som sporer AI-relaterte stillinger i norsk arbeidsmarked.",
};

export default async function OmPage() {
  const rows = await sb<SiteContent[]>(
    "/site_content?slug=eq.om&select=slug,title,body_md",
  ).catch(() => [] as SiteContent[]);
  const row = rows[0];
  const title = row?.title ?? FALLBACK.title;
  const body = row?.body_md ?? FALLBACK.body_md;

  return (
    <main className="metode">
      <h1 className="title">{title}</h1>
      {renderMarkdown(body)}
    </main>
  );
}
