// app/(site)/media/page.tsx — media-barometer stub. Title + body sourced
// from public.site_content (slug = 'media') so an admin can edit copy on
// /admin/content/media without redeploying. Falls back to a hardcoded
// copy if the row is missing (build-time prerender, fresh install before
// the seed has run, etc.) so the page never breaks.

import { sb } from "@/lib/supabase";
import { renderMarkdown } from "@/lib/admin/markdown";

type SiteContent = {
  slug: string;
  title: string;
  body_md: string;
};

const FALLBACK = {
  title: "Media-barometer",
  body_md: `En oversikt over hvordan norske medier dekker AI i arbeidsmarkedet kommer snart.

I mellomtiden, se [Jobb-barometeret](/jobb-barometer) for daglig oppdaterte tall fra NAVs stillingsfeed.`,
};

export const metadata = {
  title: "Media-barometer — Kibarometeret",
  description:
    "Hvordan norske medier dekker AI i arbeidsmarkedet. Kommer snart.",
};

export default async function MediaPage() {
  const rows = await sb<SiteContent[]>(
    "/site_content?slug=eq.media&select=slug,title,body_md",
  ).catch(() => [] as SiteContent[]);
  const row = rows[0];
  const title = row?.title ?? FALLBACK.title;
  const body = row?.body_md ?? FALLBACK.body_md;

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
        <Link href="/jobb-barometer">Jobb-barometeret</Link> for daglig oppdaterte tall fra
        NAVs stillingsfeed.
      </p>
    </main>
  );
}
