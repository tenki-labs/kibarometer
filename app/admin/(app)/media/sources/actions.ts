"use server";

import { redirect } from "next/navigation";

import { flashQs } from "@/lib/admin/flash";
import { sbFetch } from "@/lib/admin/sb";
import { fetchHtml } from "@/lib/admin/legacy/media-client.js";
import { extractArticle } from "@/lib/admin/legacy/media-extract.js";
import { parseRssFeed } from "@/lib/admin/legacy/media-discover.js";
import { runMediaBackfill } from "@/lib/admin/legacy/media-backfill.js";

const LIST = "/admin/media/sources";

const VALID_BACKFILL = new Set(["site_search", "sitemap"]);

type FormShape = {
  name: string;
  domain: string;
  is_active: boolean;
  rss_url: string | null;
  backfill_method: string;
  search_config: unknown | null;
  sitemap_url: string | null;
  sitemap_index: boolean;
  extractor_config: unknown | null;
  requires_render: boolean;
  crawl_delay_ms: number;
  notes: string | null;
};

function parseForm(formData: FormData): FormShape {
  const name = String(formData.get("name") ?? "").trim();
  const domain = String(formData.get("domain") ?? "")
    .trim()
    .toLowerCase();
  const is_active = formData.get("is_active") === "on";
  const rss_url = nonEmpty(formData.get("rss_url"));
  const backfill_method = String(formData.get("backfill_method") ?? "site_search");
  const search_config_raw = String(formData.get("search_config") ?? "").trim();
  const sitemap_url = nonEmpty(formData.get("sitemap_url"));
  const sitemap_index = formData.get("sitemap_index") === "on";
  const extractor_config_raw = String(formData.get("extractor_config") ?? "").trim();
  const requires_render = formData.get("requires_render") === "on";
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

  const search_config = parseJsonOrNull(search_config_raw, "search_config");
  const extractor_config = parseJsonOrNull(extractor_config_raw, "extractor_config");

  return {
    name,
    domain,
    is_active,
    rss_url,
    backfill_method,
    search_config,
    sitemap_url,
    sitemap_index,
    extractor_config,
    requires_render,
    crawl_delay_ms,
    notes,
  };
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
    const shape = parseForm(formData);
    const created = await sbFetch<Array<{ id: string }>>(`/media_sources`, {
      service: true,
      method: "POST",
      body: shape,
      prefer: "return=representation",
    });
    const id = created[0]?.id;
    if (!id) throw new Error("Ingen rad opprettet");
    redirect(`${LIST}/${id}/edit${flashQs({ ok: `Opprettet kilde "${shape.name}"` })}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`${LIST}/new${flashQs({ error: msg(err) })}`);
  }
}

export async function updateAction(id: string, formData: FormData) {
  try {
    const shape = parseForm(formData);
    await sbFetch(`/media_sources?id=eq.${encodeURIComponent(id)}`, {
      service: true,
      method: "PATCH",
      body: { ...shape, updated_at: new Date().toISOString() },
      prefer: "return=minimal",
    });
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

// Per-source backfill. Single tick — runs adapter (search or sitemap) for
// up to ~60 s, enqueues whatever URLs come back. The button polls until
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
// from search_config and run the extractor. Reports what came back so the
// operator can validate adapter wiring before activating the source.
export async function dryRunAction(id: string, formData: FormData) {
  const target = String(formData.get("target") ?? "rss");
  try {
    const rows = await sbFetch<
      Array<{
        rss_url: string | null;
        crawl_delay_ms: number;
        search_config: { url_template?: string; queries?: string[] } | null;
      }>
    >(
      `/media_sources?id=eq.${encodeURIComponent(id)}&select=rss_url,crawl_delay_ms,search_config`,
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
