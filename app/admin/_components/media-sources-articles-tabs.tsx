import Link from "next/link";

// Slim tab strip used at the top of /admin/media/sources and
// /admin/media/articles. Both pages stay separate URLs (so existing
// per-page query params and pagination keep working unchanged), but
// from the operator's perspective they read as two tabs of the same
// "content" surface. The active state is driven by the page that
// renders the strip — server side, no client JS — so each page passes
// `current="sources"` or `current="articles"`.

export type MediaTab = "sources" | "articles";

type Props = {
  current: MediaTab;
};

const TAB_BASE =
  "inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors";
const TAB_ACTIVE = "border-foreground text-foreground";
const TAB_INACTIVE =
  "border-transparent text-muted-foreground hover:text-foreground";

export function MediaSourcesArticlesTabs({ current }: Props) {
  return (
    <div className="mb-6 border-b">
      <nav className="-mb-px flex gap-1" aria-label="Mediedekning innhold">
        <Link
          href="/admin/media/sources"
          aria-current={current === "sources" ? "page" : undefined}
          className={`${TAB_BASE} ${current === "sources" ? TAB_ACTIVE : TAB_INACTIVE}`}
        >
          Kilder
        </Link>
        <Link
          href="/admin/media/articles"
          aria-current={current === "articles" ? "page" : undefined}
          className={`${TAB_BASE} ${current === "articles" ? TAB_ACTIVE : TAB_INACTIVE}`}
        >
          Artikler
        </Link>
      </nav>
    </div>
  );
}
