import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import {
  BACKFILL_METHODS,
  SOURCE_CATEGORIES,
  type BackfillMethod,
  type SourceCategory,
} from "./_constants";

const BACKFILL_LABEL: Record<BackfillMethod, string> = {
  scrapegraph: "scrapegraph (anbefalt)",
  rss_only: "rss_only",
  site_search: "site_search (legacy)",
  sitemap: "sitemap (legacy)",
};

const CATEGORY_LABEL: Record<SourceCategory, string> = {
  mainstream: "Mainstream daglig/ukentlig",
  tech: "Tech / IT-presse",
  business: "Næringsliv / finans",
  policy: "Politikk / spesialist",
  other: "Annet",
};

const SEARCH_CONFIG_PLACEHOLDER = `{
  "url_template": "https://www.example.no/sok?q={q}&page={page}",
  "result_selector": "article a",
  "next_page_selector": "a[rel=next]",
  "max_pages_per_query": 50
}`;

const EXTRACTOR_CONFIG_PLACEHOLDER = `{
  "strategy_order": ["jsonld", "amp", "readability"],
  "selectors": {
    "body": "article.entry-content",
    "byline": "span.author-name"
  },
  "skip_jsonld_if_paywall": false
}`;

export type SourceFormShape = {
  name?: string;
  domain?: string;
  rss_url?: string | null;
  backfill_method?: string;
  search_config?: unknown | null;
  sitemap_url?: string | null;
  sitemap_index?: boolean;
  extractor_config?: unknown | null;
  requires_render?: boolean;
  crawl_delay_ms?: number;
  is_active?: boolean;
  category?: string | null;
  notes?: string | null;
};

function jsonOrEmpty(v: unknown | null | undefined): string {
  if (v == null) return "";
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return "";
  }
}

// Shared field set used by both /new and /[id]/edit. Renders nothing on its
// own — the parent supplies <form action={…}> and submit buttons.
//
// Field strategy after PR #scrapegraph-sidecar:
//   - Always-visible "core" fields are the ones every backfill_method needs.
//   - Legacy fields (search_config, sitemap_*, extractor_config) only
//     appear inside an <details> disclosure and only for backfill_method
//     in {site_search, sitemap}. New scrapegraph sources don't see them.
//     The disclosure is server-rendered: the server action passes the
//     persisted backfill_method value. After saving, the page reloads
//     and the disclosure rerenders with the new selection. (This trades
//     instant client toggling for keeping _form.tsx a server component.)
export function SourceFields({ initial = {} }: { initial?: SourceFormShape }) {
  const backfillMethod = initial.backfill_method ?? "scrapegraph";
  const showLegacyAdvanced =
    backfillMethod === "site_search" || backfillMethod === "sitemap";

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Navn</Label>
          <Input
            id="name"
            name="name"
            required
            maxLength={200}
            placeholder="Digi.no"
            defaultValue={initial.name ?? ""}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="domain">Domene</Label>
          <Input
            id="domain"
            name="domain"
            required
            maxLength={200}
            placeholder="digi.no"
            className="font-mono"
            defaultValue={initial.domain ?? ""}
          />
          <p className="text-xs text-muted-foreground">
            Uten <code className="font-mono">https://</code> og{" "}
            <code className="font-mono">www.</code>. Brukes for robots.txt og
            UA-rapportering.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="rss_url">RSS-URL</Label>
          <Input
            id="rss_url"
            name="rss_url"
            placeholder="https://www.digi.no/rss"
            className="font-mono"
            defaultValue={initial.rss_url ?? ""}
          />
          <p className="text-xs text-muted-foreground">
            Tom om kilden ikke tilbyr RSS — da poller bare backfill den.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="crawl_delay_ms">crawl_delay_ms</Label>
          <Input
            id="crawl_delay_ms"
            name="crawl_delay_ms"
            type="number"
            min={100}
            step={100}
            defaultValue={initial.crawl_delay_ms ?? 1000}
          />
          <p className="text-xs text-muted-foreground">
            Tid mellom forespørsler til denne kilden. Default 1000 ms.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="backfill_method">Backfill-metode</Label>
          <Select
            name="backfill_method"
            defaultValue={backfillMethod}
          >
            <SelectTrigger id="backfill_method">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BACKFILL_METHODS.map((m) => (
                <SelectItem key={m} value={m}>{BACKFILL_LABEL[m]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            <code className="font-mono">scrapegraph</code> driver
            URL-oppdaging via DuckDuckGo + Playwright +
            lokal MLX-LLM (kiba-scraper-sidecar). Krever ingen
            per-kilde-konfigurasjon.{" "}
            <code className="font-mono">rss_only</code> bruker bare RSS-feeden.{" "}
            <code className="font-mono">site_search</code> og{" "}
            <code className="font-mono">sitemap</code> er beholdt for
            bakoverkompatibilitet med tidlige seeds (Digi.no, Kode24).
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="category">Kategori (for /metode-publisering)</Label>
          <Select
            name="category"
            defaultValue={initial.category ?? "other"}
          >
            <SelectTrigger id="category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{CATEGORY_LABEL[c]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Vises i <code className="font-mono">/metode</code> (Kilder-seksjonen)
            for redaksjonell åpenhet om hvilke outletter som er dekket.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            id="is_active"
            name="is_active"
            defaultChecked={initial.is_active ?? false}
          />
          <span>Aktiv (poll og backfill kjører)</span>
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="notes">Notater</Label>
        <Textarea
          id="notes"
          name="notes"
          rows={3}
          placeholder="Operative observasjoner, paywall-status, etc."
          defaultValue={initial.notes ?? ""}
        />
      </div>

      {showLegacyAdvanced ? (
        <details className="rounded-md border border-dashed border-muted-foreground/30 p-4">
          <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
            Avansert: legacy-konfig (kun for site_search / sitemap)
          </summary>
          <div className="mt-4 flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <Label htmlFor="sitemap_url">sitemap_url</Label>
              <Input
                id="sitemap_url"
                name="sitemap_url"
                placeholder="https://www.example.no/sitemap.xml"
                className="font-mono"
                defaultValue={initial.sitemap_url ?? ""}
              />
              <label className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  id="sitemap_index"
                  name="sitemap_index"
                  defaultChecked={initial.sitemap_index ?? false}
                />
                <span>
                  <code className="font-mono">sitemap.xml</code> er en indeks
                  (peker på månedlige sitemaps)
                </span>
              </label>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="search_config">search_config (JSON)</Label>
              <Textarea
                id="search_config"
                name="search_config"
                rows={10}
                spellCheck={false}
                className="font-mono text-xs"
                placeholder={SEARCH_CONFIG_PLACEHOLDER}
                defaultValue={jsonOrEmpty(initial.search_config)}
              />
              <p className="text-xs text-muted-foreground">
                Per-outlet søk-template. Brukt av <code className="font-mono">site_search</code>-adapteren.
                For nye kilder, bruk <code className="font-mono">scrapegraph</code> i stedet.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="extractor_config">extractor_config (JSON, valgfri)</Label>
              <Textarea
                id="extractor_config"
                name="extractor_config"
                rows={8}
                spellCheck={false}
                className="font-mono text-xs"
                placeholder={EXTRACTOR_CONFIG_PLACEHOLDER}
                defaultValue={jsonOrEmpty(initial.extractor_config)}
              />
              <p className="text-xs text-muted-foreground">
                Per-kilde-overstyringer på ekstraksjons-tieren. La stå tom for å
                bruke standard rekkefølge (jsonld → readability → og-only).
              </p>
            </div>
          </div>
        </details>
      ) : null}
    </div>
  );
}
