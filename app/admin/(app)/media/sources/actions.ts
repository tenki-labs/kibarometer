"use server";

import { redirect } from "next/navigation";

import { flashQs } from "@/lib/admin/flash";
import { sbFetch } from "@/lib/admin/sb";
import { fetchHtml } from "@/lib/admin/legacy/media-client.js";
import { extractArticle } from "@/lib/admin/legacy/media-extract.js";
import { parseRssFeed } from "@/lib/admin/legacy/media-discover.js";
import { runMediaBackfill } from "@/lib/admin/legacy/media-backfill.js";
import { discoverUrls as scraperDiscoverUrls } from "@/lib/admin/legacy/media-scraper-client.js";

const LIST = "/admin/media/sources";

const VALID_BACKFILL = new Set([
  "scrapegraph",
  "rss_only",
  "site_search",
  "sitemap",
]);
const VALID_CATEGORY = new Set([
  "mainstream",
  "tech",
  "business",
  "policy",
  "other",
]);

// SourcePatch only includes the fields that were actually present in the
// submitted form. Fields rendered conditionally (search_config etc. for
// scrapegraph rows where the disclosure is hidden) are omitted entirely
// so the PATCH doesn't null them.
type SourcePatch = {
  name: string;
  domain: string;
  is_active: boolean;
  rss_url: string | null;
  backfill_method: string;
  crawl_delay_ms: number;
  notes: string | null;
  category?: string;
  search_config?: unknown | null;
  sitemap_url?: string | null;
  sitemap_index?: boolean;
  extractor_config?: unknown | null;
  requires_render?: boolean;
};

function parseForm(formData: FormData): SourcePatch {
  const name = String(formData.get("name") ?? "").trim();
  const domain = String(formData.get("domain") ?? "")
    .trim()
    .toLowerCase();
  const is_active = formData.get("is_active") === "on";
  const rss_url = nonEmpty(formData.get("rss_url"));
  const backfill_method = String(formData.get("backfill_method") ?? "scrapegraph");
  const crawlRaw = String(formData.get("crawl_delay_ms") ?? "1000").trim();
  const notes = nonEmpty(formData.get("notes"));

  if (!name) throw new Error("Navn mangler");
  if (!domain) throw new Error("Domene mangler");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
    throw new Error("Ugyldig domene (forventet f.eks. digi.no)");
  }
  if (!VALID_BACKFILL.has(backfill_method)) {
    throw new Error(`Ugyldig backfill-metode: ${backfill_method}`);
  }
  const crawl_delay_ms = Number(crawlRaw);
  if (!Number.isInteger(crawl_delay_ms) || crawl_delay_ms < 100) {
    throw new Error("crawl_delay_ms må være et heltall ≥ 100");
  }

  const patch: SourcePatch = {
    name,
    domain,
    is_active,
    rss_url,
    backfill_method,
    crawl_delay_ms,
    notes,
  };

  // Category is in the always-visible field set; treat as required-with-default.
  if (formData.has("category")) {
    const category = String(formData.get("category") ?? "other");
    if (!VALID_CATEGORY.has(category)) {
      throw new Error(`Ugyldig kategori: ${category}`);
    }
    patch.category = category;
  }

  // Legacy fields — only present in the form when the user has the
  // "Avansert: legacy-konfig" disclosure rendered (i.e. backfill_method
  // is site_search or sitemap). When omitted, do NOT overwrite the
  // existing DB value.
  if (formData.has("search_config")) {
    const raw = String(formData.get("search_config") ?? "").trim();
    patch.search_config = parseJsonOrNull(raw, "search_config");
  }
  if (formData.has("extractor_config")) {
    const raw = String(formData.get("extractor_config") ?? "").trim();
    patch.extractor_config = parseJsonOrNull(raw, "extractor_config");
  }
  if (formData.has("sitemap_url")) {
    patch.sitemap_url = nonEmpty(formData.get("sitemap_url"));
  }
  if (formData.has("sitemap_index")) {
    patch.sitemap_index = formData.get("sitemap_index") === "on";
  }
  // requires_render checkbox dropped from UI; we no longer write it.

  return patch;
}

function parseJsonOrNull(raw: string, label: string): unknown | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `${label}: ugyldig JSON — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function nonEmpty(v: FormDataEntryValue | null): string | null {
  if (v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export async function createAction(formData: FormData) {
  try {
    const patch = parseForm(formData);
    const created = await sbFetch<Array<{ id: string }>>(`/media_sources`, {
      service: true,
      method: "POST",
      body: patch,
      prefer: "return=representation",
    });
    const id = created[0]?.id;
    if (!id) throw new Error("Ingen rad opprettet");
    redirect(`${LIST}/${id}/edit${flashQs({ ok: `Opprettet kilde "${patch.name}"` })}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`${LIST}/new${flashQs({ error: msg(err) })}`);
  }
}

export async function updateAction(id: string, formData: FormData) {
  try {
    const patch = parseForm(formData);
    // return=representation so we can assert the write actually landed —
    // a silent "Lagret" with stale search_config would block the operator
    // from ever activating new outlets. We only verify search_config when
    // the form actually included it (otherwise it's intentionally untouched).
    const updated = await sbFetch<Array<{ search_config: unknown }>>(
      `/media_sources?id=eq.${encodeURIComponent(id)}`,
      {
        service: true,
        method: "PATCH",
        body: { ...patch, updated_at: new Date().toISOString() },
        prefer: "return=representation",
      },
    );
    const row = updated[0];
    if (!row) {
      throw new Error(
        "PATCH returnerte ingen rad — kilden finnes ikke eller RLS blokkerte skrivingen",
      );
    }
    if ("search_config" in patch) {
      const sentSc = JSON.stringify(patch.search_config ?? null);
      const gotSc = JSON.stringify(row.search_config ?? null);
      if (sentSc !== gotSc) {
        throw new Error(
          `search_config ble ikke skrevet. Sendt: ${sentSc.slice(0, 120)} · I DB: ${gotSc.slice(0, 120)}`,
        );
      }
    }
    redirect(`${LIST}/${id}/edit${flashQs({ ok: "Lagret" })}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`${LIST}/${id}/edit${flashQs({ error: msg(err) })}`);
  }
}

export async function toggleActiveAction(id: string, formData: FormData) {
  const next = String(formData.get("is_active") ?? "false") === "true";
  try {
    await sbFetch(`/media_sources?id=eq.${encodeURIComponent(id)}`, {
      service: true,
      method: "PATCH",
      body: { is_active: next, updated_at: new Date().toISOString() },
      prefer: "return=minimal",
    });
    redirect(
      `${LIST}${flashQs({ ok: next ? "Kilde aktivert" : "Kilde deaktivert" })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`${LIST}${flashQs({ error: msg(err) })}`);
  }
}

// Per-source backfill. Single tick — runs adapter (scrapegraph / search /
// sitemap) for up to ~60 s, enqueues whatever URLs come back. The button
// polls until stats.urls_found stops growing. We deliberately run inline
// (not in a background task) so the operator sees the result in the flash QS.
export async function backfillSourceAction(id: string) {
  try {
    const result = await runMediaBackfill({
      sb: sbFetch,
      sourceId: id,
      trigger: "manual",
    });
    redirect(
      `${LIST}${flashQs({
        ok:
          `Backfill ${result.domain}: ${result.urls_found} URL-er funnet, ` +
          `${result.enqueued} nye i kø` +
          (result.stopped && result.stopped !== "completed"
            ? ` (stoppet: ${result.stopped})`
            : ""),
      })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`${LIST}${flashQs({ error: msg(err) })}`);
  }
}

// Dry-run: fetch the source's RSS once and parse it, OR fetch a sample URL
// from search_config and run the extractor, OR run scrapegraph-discover for
// one keyword and report the URLs it finds. Reports what came back so the
// operator can validate adapter wiring before activating the source.
export async function dryRunAction(id: string, formData: FormData) {
  const target = String(formData.get("target") ?? "rss");
  try {
    const rows = await sbFetch<
      Array<{
        domain: string;
        rss_url: string | null;
        crawl_delay_ms: number;
        backfill_method: string;
        search_config: { url_template?: string; queries?: string[] } | null;
      }>
    >(
      `/media_sources?id=eq.${encodeURIComponent(id)}&select=domain,rss_url,crawl_delay_ms,backfill_method,search_config`,
      { service: true },
    );
    const src = rows[0];
    if (!src) throw new Error("Fant ikke kilden");

    if (target === "rss") {
      if (!src.rss_url) throw new Error("Kilden har ingen rss_url");
      const res = await fetchHtml(src.rss_url, {
        crawlDelayMs: src.crawl_delay_ms,
      });
      if (!res.ok) {
        throw new Error(
          res.disallowed ? "robots.txt blokkerer feeden" : `HTTP ${res.status ?? "net"}`,
        );
      }
      const items = parseRssFeed(res.body);
      redirect(
        `${LIST}/${id}/edit${flashQs({
          ok: `RSS-tørrtest: ${items.length} elementer parset. ${
            items[0]?.title ? `Første: "${items[0].title.slice(0, 80)}"` : ""
          }`,
        })}`,
      );
    }

    if (target === "scrapegraph") {
      // Pull one keyword from the central catalogue and ask the kiba-scraper
      // sidecar for top 5 URLs against this source's domain. Cheap probe.
      const kwRows = await sbFetch<Array<{ term: string }>>(
        "/keywords?status=in.(canonical,trial)&domain=in.(media,any)&select=term&limit=1",
        { service: true },
      );
      const term = kwRows[0]?.term;
      if (!term) {
        throw new Error("Ingen aktive keywords for media — sjekk /admin/keywords");
      }
      const result = await scraperDiscoverUrls({
        queries: [term],
        site: src.domain,
        numResults: 5,
      });
      const sample = result.urls
        .slice(0, 3)
        .map((u) => u.replace(/^https?:\/\/(www\.)?/, ""))
        .join(", ");
      redirect(
        `${LIST}/${id}/edit${flashQs({
          ok:
            `Scrapegraph-tørrtest (term="${term}", site:${src.domain}): ${result.urls.length} URL-er. ` +
            (sample ? `Eks: ${sample}` : "Ingen treff."),
        })}`,
      );
    }

    if (target === "extract") {
      const sampleUrl = String(formData.get("sample_url") ?? "").trim();
      if (!sampleUrl) throw new Error("Lim inn en URL å teste");
      const res = await fetchHtml(sampleUrl, {
        crawlDelayMs: src.crawl_delay_ms,
      });
      if (!res.ok) {
        throw new Error(
          res.disallowed ? "robots.txt blokkerer URL" : `HTTP ${res.status ?? "net"}`,
        );
      }
      const extracted = extractArticle(res.body);
      redirect(
        `${LIST}/${id}/edit${flashQs({
          ok: `Ekstraksjon: strategi=${extracted.extraction_strategy_used}, kvalitet=${extracted.extraction_quality}, headline="${(extracted.headline ?? "").slice(0, 80)}"`,
        })}`,
      );
    }

    throw new Error(`Ukjent tørrtest: ${target}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`${LIST}/${id}/edit${flashQs({ error: msg(err) })}`);
  }
}

function isRedirect(err: unknown): boolean {
  return (
    err instanceof Error &&
    "digest" in err &&
    typeof (err as { digest: unknown }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
