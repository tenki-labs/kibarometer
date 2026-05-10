"use server";

import { redirect } from "next/navigation";

import { flashQs } from "@/lib/admin/flash";
import { sbFetch } from "@/lib/admin/sb";
import { fetchHtml } from "@/lib/admin/legacy/media-client.js";
import { extractArticle } from "@/lib/admin/legacy/media-extract.js";
import { parseRssFeed } from "@/lib/admin/legacy/media-discover.js";
import { runMediaBackfill } from "@/lib/admin/legacy/media-backfill.js";
import { discoverUrls as scraperDiscoverUrls } from "@/lib/admin/legacy/media-scraper-client.js";
import { loadActiveMediaKeywords } from "@/lib/admin/legacy/media-processor.js";

import { SOURCE_CATEGORIES } from "./_constants";

const LIST = "/admin/media/sources";

const VALID_CATEGORY = new Set<string>(SOURCE_CATEGORIES);

type SourcePatch = {
  name: string;
  domain: string;
  is_active: boolean;
  rss_url: string | null;
  crawl_delay_ms: number;
  notes: string | null;
  category?: string;
};

function parseForm(formData: FormData): SourcePatch {
  const name = String(formData.get("name") ?? "").trim();
  const domain = String(formData.get("domain") ?? "")
    .trim()
    .toLowerCase();
  const is_active = formData.get("is_active") === "on";
  const rss_url = nonEmpty(formData.get("rss_url"));
  const crawlRaw = String(formData.get("crawl_delay_ms") ?? "1000").trim();
  const notes = nonEmpty(formData.get("notes"));

  if (!name) throw new Error("Navn mangler");
  if (!domain) throw new Error("Domene mangler");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
    throw new Error("Ugyldig domene (forventet f.eks. digi.no)");
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
    crawl_delay_ms,
    notes,
  };

  if (formData.has("category")) {
    const category = String(formData.get("category") ?? "other");
    if (!VALID_CATEGORY.has(category)) {
      throw new Error(`Ugyldig kategori: ${category}`);
    }
    patch.category = category;
  }

  return patch;
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
    const updated = await sbFetch<Array<{ id: string }>>(
      `/media_sources?id=eq.${encodeURIComponent(id)}`,
      {
        service: true,
        method: "PATCH",
        body: { ...patch, updated_at: new Date().toISOString() },
        prefer: "return=representation",
      },
    );
    if (!updated[0]) {
      throw new Error(
        "PATCH returnerte ingen rad — kilden finnes ikke eller RLS blokkerte skrivingen",
      );
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

// Per-source backfill. Single tick — runs the scrapegraph adapter for up
// to ~60 s, enqueues whatever URLs come back. The button polls until
// stats.urls_found stops growing. We deliberately run inline (not in a
// background task) so the operator sees the result in the flash QS.
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
          backfillFlashSuffix(result),
      })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`${LIST}${flashQs({ error: msg(err) })}`);
  }
}

// When urls_found is 0, the default "Backfill X: 0 URL-er funnet" reads
// like a successful no-op even when the adapter actually misbehaved.
// Append whatever signal we have (stopped reason, scrapegraph result
// shape, off-domain drop count) so the operator can tell apart "search
// returned nothing" from "search returned things our parser dropped".
// Full metadata still lives on /admin/processes/{job_id}.
function backfillFlashSuffix(result: {
  urls_found?: number;
  stopped?: string;
  result_shapes?: unknown;
  dropped_off_domain?: number;
}): string {
  const bits: string[] = [];
  if (result.stopped && result.stopped !== "completed") {
    bits.push(`stoppet: ${result.stopped}`);
  }
  if ((result.urls_found ?? 0) === 0) {
    if (Array.isArray(result.result_shapes) && result.result_shapes.length > 0) {
      const shapes = (result.result_shapes as unknown[])
        .map((s) => String(s))
        .slice(0, 3)
        .join(" | ");
      bits.push(`resultat-form: ${shapes}`);
    }
    if (typeof result.dropped_off_domain === "number" && result.dropped_off_domain > 0) {
      bits.push(`${result.dropped_off_domain} forkastet utenfor domenet`);
    }
  }
  return bits.length > 0 ? ` (${bits.join("; ")})` : "";
}

// Dry-run: fetch the source's RSS once and parse it, OR run
// scrapegraph-discover for one keyword and report the URLs it finds, OR
// fetch a sample URL and run the legacy JSON-LD extractor. Reports what
// came back so the operator can validate wiring before activating.
export async function dryRunAction(id: string, formData: FormData) {
  const target = String(formData.get("target") ?? "rss");
  try {
    const rows = await sbFetch<
      Array<{
        domain: string;
        rss_url: string | null;
        crawl_delay_ms: number;
      }>
    >(
      `/media_sources?id=eq.${encodeURIComponent(id)}&select=domain,rss_url,crawl_delay_ms`,
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
      const kwRows = await loadActiveMediaKeywords(sbFetch);
      const term = (Array.isArray(kwRows) ? kwRows : [])[0]?.term;
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
