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
export function SourceFields({ initial = {} }: { initial?: SourceFormShape }) {
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
            defaultValue={initial.backfill_method ?? "site_search"}
          >
            <SelectTrigger id="backfill_method">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="site_search">site_search</SelectItem>
              <SelectItem value="sitemap">sitemap</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            <code className="font-mono">site_search</code> driver søkesidens AI-spørringer; brukes når kilden har søkefunksjon.{" "}
            <code className="font-mono">sitemap</code> går gjennom sitemap-indeksen og bruker post-fetch-filtrering (kostbar for ikke-AI-tunge kilder).
          </p>
        </div>
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
              <code className="font-mono">sitemap.xml</code> er en indeks (peker på månedlige sitemaps)
            </span>
          </label>
        </div>
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
          Brukes av backfill-orkestratoren til å iterere{" "}
          <code className="font-mono">queries × pages</code>. Søkeordene
          hentes fra <code className="font-mono">/admin/keywords</code> (rader
          med <code className="font-mono">domain</code> i{" "}
          <code className="font-mono">media</code>/<code className="font-mono">any</code>) —
          ikke list dem her. La feltet stå tomt for å bruke sitemap-fallback.
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

      <div className="flex flex-col gap-3 sm:flex-row sm:gap-6">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            id="is_active"
            name="is_active"
            defaultChecked={initial.is_active ?? false}
          />
          <span>Aktiv (poll og backfill kjører)</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            id="requires_render"
            name="requires_render"
            defaultChecked={initial.requires_render ?? false}
          />
          <span>requires_render (headless fallback — v1.1)</span>
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
    </div>
  );
}
