// lib/admin/legacy/media-discover.js
// RSS/Atom discover orchestrator. For each active source with rss_url:
//   1. fetch the feed politely (UA, robots, per-host crawl_delay)
//   2. parse out title/link/description per item (RSS 2.0 + Atom)
//   3. run the keyword matcher on title + description (Stage 1 of the
//      cascade — saves bandwidth and the courtesy load on the outlet)
//   4. enqueue surviving URLs into media_url_queue, idempotent on url_hash
//
// Re-discovery is a no-op via media_url_queue.url_hash UNIQUE +
// Prefer: resolution=ignore-duplicates. The same URL surfacing in two
// successive RSS polls (or RSS + backfill simultaneously) doesn't add
// duplicate work.

import { fetchHtml } from "./media-client.js";
import { decodeEntities } from "./media-extract.js";
import {
  canonicalizeUrl,
  compileMatchers,
  loadActiveMediaKeywords,
  rssItemMatchesKeywords,
  urlHash,
} from "./media-processor.js";

const JOB_NAME = "media_discover";
const WALL_TIME_MS = 60_000;

// Per-source cap. Norwegian feeds are short (≤50 items typical) but a
// misbehaving source could ship thousands; the cap protects the
// orchestrator's wall budget.
const MAX_ITEMS_PER_SOURCE = 100;

// Batch size for the queue insert. Small enough that a transient PostgREST
// hiccup costs at most one batch from one source, large enough that a
// healthy poll completes in a handful of round-trips.
const ENQUEUE_BATCH = 25;

// ── RSS / Atom parser ────────────────────────────────────────────────────
// Hand-rolled, tolerant, regex-based. The two real-world feeds we target
// (RSS 2.0 from digi.no, Atom from many WordPress-backed outlets) are both
// well-formed enough that a strict parser would buy little. Pre-strip
// CDATA so descriptions match cleanly.

const ITEM_BLOCK_RE = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
const ENTRY_BLOCK_RE = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;

export function parseRssFeed(xml) {
  if (!xml || typeof xml !== "string") return [];
  const cleaned = xml.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");

  const out = [];
  const seen = new Set();
  for (const re of [ITEM_BLOCK_RE, ENTRY_BLOCK_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(cleaned)) !== null) {
      const item = parseItemBlock(m[1]);
      if (!item.link) continue;
      // De-dupe on raw link: some feeds emit both <item> and <entry> for
      // the same article. Canonicalization happens later.
      if (seen.has(item.link)) continue;
      seen.add(item.link);
      out.push(item);
      if (out.length >= MAX_ITEMS_PER_SOURCE) return out;
    }
  }
  return out;
}

function parseItemBlock(block) {
  const title = readField(block, "title");
  let link = readField(block, "link");
  if (!link) {
    // Atom: <link href="…" rel="alternate"/> — read href off the tag.
    const hrefMatch = block.match(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i);
    if (hrefMatch) link = hrefMatch[1];
  }
  const description =
    readField(block, "description") ||
    readField(block, "summary") ||
    readField(block, "content") ||
    "";
  const pubDate =
    readField(block, "pubDate") ||
    readField(block, "published") ||
    readField(block, "updated") ||
    null;
  const guid = readField(block, "guid") || readField(block, "id") || null;
  return {
    title: title ? decodeEntities(stripInner(title)) : null,
    link: link ? decodeEntities(link.trim()) : null,
    description: description ? decodeEntities(stripInner(description)) : "",
    pubDate,
    guid,
  };
}

function readField(block, name) {
  const re = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i");
  const m = block.match(re);
  return m ? m[1].trim() : null;
}

function stripInner(s) {
  return String(s)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Orchestrator ─────────────────────────────────────────────────────────

/**
 * @param {object} args
 * @param {(path: string, init?: any) => Promise<any>} args.sb
 * @param {"manual" | "cron"} [args.trigger]
 * @param {Function} [args.fetcher]
 * @param {() => number} [args.now]
 * @param {number} [args.maxWallMs]  Per-tick cumulative wall budget across
 *   all sources. Defaults to {@link WALL_TIME_MS} (60 s) — same value the
 *   constant carried before this was a parameter, so cron + admin button
 *   behavior is unchanged. Tests pass a tiny budget to verify the loop
 *   bails between sources.
 */
export async function runDiscover({
  sb,
  trigger = "manual",
  fetcher,
  now = () => Date.now(),
  maxWallMs = WALL_TIME_MS,
}) {
  const startMs = now();

  const sources = await sb(
    "/media_sources?is_active=eq.true&rss_url=not.is.null" +
      "&select=id,name,domain,rss_url,crawl_delay_ms",
    { service: true },
  );

  if (!Array.isArray(sources) || sources.length === 0) {
    return finalizeNoOp(sb, trigger, "no_active_rss_sources");
  }

  const matchers = compileMatchers(await loadActiveMediaKeywords(sb));
  const [job] = await sb("/jobs", {
    service: true,
    method: "POST",
    body: {
      name: JOB_NAME,
      trigger,
      metadata: { sources: sources.length },
    },
    prefer: "return=representation",
  });

  let itemsSeen = 0;
  let itemsMatched = 0;
  let enqueued = 0;
  const errors = [];

  try {
    for (const source of sources) {
      if (now() - startMs > maxWallMs) break;

      const res = await fetchHtml(source.rss_url, {
        crawlDelayMs: source.crawl_delay_ms || undefined,
        ...(fetcher ? { fetcher } : {}),
      });

      if (!res.ok) {
        errors.push({
          source: source.domain,
          error: res.disallowed ? "robots_disallow" : `http_${res.status || "net"}`,
        });
        continue;
      }

      const items = parseRssFeed(res.body);
      itemsSeen += items.length;

      const toEnqueue = [];
      for (const item of items) {
        if (!item.link) continue;
        const tags = rssItemMatchesKeywords(item, matchers);
        if (!tags.is_ai) continue;
        itemsMatched += 1;
        const canonical = canonicalizeUrl(item.link);
        if (!canonical) continue;
        toEnqueue.push({
          source_id: source.id,
          url: canonical,
          url_hash: urlHash(item.link),
        });
      }

      enqueued += await batchInsertQueue(sb, toEnqueue);

      // last_polled_at advances on every successful fetch — operators
      // watch this column to detect silent breakage of an outlet's RSS
      // (a feed that 404s or returns garbage stops advancing).
      await sb(`/media_sources?id=eq.${encodeURIComponent(source.id)}`, {
        service: true,
        method: "PATCH",
        body: { last_polled_at: new Date().toISOString() },
        prefer: "return=minimal",
      });
    }

    const meta = {
      sources: sources.length,
      items_seen: itemsSeen,
      items_matched: itemsMatched,
      enqueued,
      errors: errors.slice(0, 10),
    };
    await sb(`/jobs?id=eq.${job.id}`, {
      service: true,
      method: "PATCH",
      body: {
        finished_at: new Date().toISOString(),
        status: "success",
        rows_processed: enqueued,
        metadata: meta,
      },
    });
    return { status: "success", job_id: job.id, ...meta };
  } catch (err) {
    await sb(`/jobs?id=eq.${job.id}`, {
      service: true,
      method: "PATCH",
      body: {
        finished_at: new Date().toISOString(),
        status: "failed",
        error: String(err.message || err).slice(0, 1000),
        metadata: {
          sources: sources.length,
          items_seen: itemsSeen,
          items_matched: itemsMatched,
          enqueued,
          errors: errors.slice(0, 10),
        },
      },
    });
    throw err;
  }
}

async function batchInsertQueue(sb, rows) {
  if (rows.length === 0) return 0;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += ENQUEUE_BATCH) {
    const slice = rows.slice(i, i + ENQUEUE_BATCH);
    try {
      const result = await sb("/media_url_queue", {
        service: true,
        method: "POST",
        body: slice,
        prefer: "resolution=ignore-duplicates,return=representation",
      });
      inserted += Array.isArray(result) ? result.length : 0;
    } catch (err) {
      console.error("batchInsertQueue failed (non-fatal):", err.message);
    }
  }
  return inserted;
}

async function finalizeNoOp(sb, trigger, reason) {
  const [job] = await sb("/jobs", {
    service: true,
    method: "POST",
    body: { name: JOB_NAME, trigger, metadata: { reason } },
    prefer: "return=representation",
  });
  await sb(`/jobs?id=eq.${job.id}`, {
    service: true,
    method: "PATCH",
    body: {
      finished_at: new Date().toISOString(),
      status: "success",
      rows_processed: 0,
    },
  });
  return { status: "noop", reason, job_id: job.id };
}

export const _internals = { parseRssFeed, parseItemBlock };
