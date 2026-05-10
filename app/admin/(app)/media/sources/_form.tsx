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
  SOURCE_CATEGORIES,
  type SourceCategory,
} from "./_constants";

const CATEGORY_LABEL: Record<SourceCategory, string> = {
  mainstream: "Mainstream daglig/ukentlig",
  tech: "Tech / IT-presse",
  business: "Næringsliv / finans",
  policy: "Politikk / spesialist",
  other: "Annet",
};

export type SourceFormShape = {
  name?: string;
  domain?: string;
  rss_url?: string | null;
  crawl_delay_ms?: number;
  is_active?: boolean;
  category?: string | null;
  notes?: string | null;
};

// Shared field set used by both /new and /[id]/edit. Renders nothing on its
// own — the parent supplies <form action={…}> and submit buttons. Every
// source uses backfill_method='scrapegraph' (the only allowed value since
// migration 0057), so no per-source adapter config is exposed.
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
            Tom om kilden ikke tilbyr RSS — backfill kjører uansett via
            kiba-scraper-sidecaren.
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
    </div>
  );
}
