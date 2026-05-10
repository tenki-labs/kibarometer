// lib/admin/legacy/media-scraper-client.js
// Thin fetch wrapper around the kiba-scraper sidecar (POST /discover,
// POST /extract). Sibling to media-search.js (legacy site_search
// adapter) — both ultimately produce a list of URLs that the backfill
// orchestrator enqueues into media_url_queue.
//
// Caller decides what to do on failure. We don't fall back here;
// media-extract.js handles the JSON-LD/scraper escalation logic.

// 90 s leaves ~40 s headroom over the sidecar's default 50 s internal
// wall budget (DiscoverRequest.max_wall_seconds in schemas.py). Earlier
// 60 s was too tight: ddgs+Playwright+MLX makes each keyword take
// 5-15 s, so a 20-keyword batch reliably overran 60 s and aborted before
// the sidecar got to send its (partial) response.
const DEFAULT_DISCOVER_TIMEOUT_MS = 90_000;
const DEFAULT_EXTRACT_TIMEOUT_MS = 90_000;

function scraperBaseUrl() {
  const url = process.env.SCRAPER_URL;
  if (!url) {
    throw new Error("SCRAPER_URL er ikke satt — kiba-scraper-sidecar er ikke konfigurert");
  }
  return url.replace(/\/+$/, "");
}

async function postJson(path, body, { timeoutMs }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${scraperBaseUrl()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let parsed = null;
    if (text) {
      try { parsed = JSON.parse(text); } catch { parsed = text; }
    }
    if (!res.ok) {
      const detail = (parsed && typeof parsed === "object" && "detail" in parsed)
        ? parsed.detail
        : parsed || res.statusText;
      const err = new Error(
        `kiba-scraper ${path} → ${res.status}: ${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 200)}`,
      );
      err.status = res.status;
      err.detail = detail;
      throw err;
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Discover article URLs by keyword search. Mirrors the {urls, stats}
 * shape that searchSourceUrls() in media-search.js returns so the
 * backfill orchestrator can consume either adapter without branching.
 *
 * @param {object} args
 * @param {string[]} args.queries           Keyword terms (from public.keywords)
 * @param {string=}  args.site              Optional domain filter, e.g. 'nrk.no'
 * @param {number=}  args.numResults        Max URLs per query (1-50, default 10)
 * @param {number=}  args.timeoutMs
 */
export async function discoverUrls({
  queries,
  site,
  numResults,
  timeoutMs = DEFAULT_DISCOVER_TIMEOUT_MS,
} = {}) {
  if (!Array.isArray(queries) || queries.length === 0) {
    throw new Error("queries er tom");
  }
  const body = { queries };
  if (site) body.site = site;
  if (numResults != null) body.num_results = numResults;

  const data = await postJson("/discover", body, { timeoutMs });
  const urls = Array.isArray(data?.urls) ? data.urls.map(String) : [];
  const stats = (data && typeof data === "object" && data.stats) ? data.stats : {
    queries_run: 0, pages_fetched: 0, duration_ms: 0, stopped: "unknown",
  };
  return { urls, stats };
}

/**
 * Extract structured fields from a single article URL via the LLM-backed
 * SmartScraperGraph. Returns a normalised record matching the columns
 * we care about on media_articles, OR throws.
 *
 * Distinct error shapes the caller may want to handle:
 *   - status=422  → schema_mismatch (LLM hallucinated). Caller should
 *     fall back to media-extract.js's JSON-LD path.
 *   - status=502  → scrapegraphai upstream crash (Playwright timeout,
 *     LLM 5xx, etc.). Retry is reasonable.
 *   - other       → kiba-scraper unreachable / config error.
 *
 * @param {string} url
 * @param {{ timeoutMs?: number }} [opts]
 */
export async function extractArticle(url, { timeoutMs = DEFAULT_EXTRACT_TIMEOUT_MS } = {}) {
  if (typeof url !== "string" || !url) throw new Error("url mangler");
  const data = await postJson("/extract", { url }, { timeoutMs });
  const result = data?.result;
  if (!result || typeof result !== "object") {
    throw new Error("kiba-scraper /extract: tomt eller uventet resultat");
  }
  return {
    url: data.url,
    title: result.title ?? null,
    body: result.body ?? "",
    published_at: result.published_at ?? null,
    author: result.author ?? null,
  };
}

/**
 * Cheap readiness probe. Useful from a /admin/diag panel.
 */
export async function scraperHealthz({ timeoutMs = 5_000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${scraperBaseUrl()}/healthz`, { signal: ctrl.signal });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* keep null */ }
    return { ok: res.ok, status: res.status, body: parsed };
  } catch (err) {
    return { ok: false, status: 0, body: null, error: String(err?.message || err) };
  } finally {
    clearTimeout(timer);
  }
}
