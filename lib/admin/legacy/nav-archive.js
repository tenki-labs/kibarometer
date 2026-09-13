// lib/admin/legacy/nav-archive.js
// Archive enrichment for nav_postings — recovers `description` (and the
// real published/expires dates) for postings NAV's feed API will never
// serve again. Two orchestrators, same shape as jobs.js:
//
//   archiveIndexNav   weekly. Pulls the capture listings for every ad page
//                     from Common Crawl (per crawl, paginated) and the
//                     Wayback Machine (per month) into nav_archive_index.
//                     Immutable sources (finished CC crawls, old Wayback
//                     months) are pulled once; the two most recent months
//                     are re-pulled because captures keep arriving.
//
//   archiveEnrichNav  every 15 min. Two passes inside one wall budget:
//                     (1) live pass — arbeidsplassen.nav.no still serves
//                         INACTIVE ads for ~5 months after expiry, so any
//                         posting younger than LIVE_WINDOW_DAYS is tried
//                         there first (one cheap GET, no archive needed);
//                     (2) archive pass — drains nav_archive_queue, trying
//                         Common Crawl captures (no rate limit) before
//                         Wayback captures (~1 req/s, backs off on 429).
//
// Both take injectable `fetcher` / `sleep` / `now` so the tests never touch
// the network or the clock. See CLAUDE.md §2 for the data story.

import { heartbeat, sweepStaleRunningJobs } from "./jobs.js";
import { applyTags, compileMatchers, loadActiveKeywords } from "./nav-processor.js";
import { parseArbeidsplassenAd } from "./nav-archive-parse.js";
import {
  ARCHIVE_FLOOR_YEAR,
  fetchCcIndexPage,
  fetchCcIndexPageCount,
  fetchCcWarcRecord,
  fetchLiveAdPage,
  fetchWaybackCapture,
  fetchWaybackCdx,
  listCcCrawls,
} from "./nav-archive-sources.js";

export const ARCHIVE_INDEX_JOB = "archive_index_nav";
export const ARCHIVE_ENRICH_JOB = "archive_enrich_nav";

// NAV ads expire at most 6 months after publication and the public page
// keeps an expired ad for ~5 months more, so a posting can be at most
// ~11 months old and still be on the live site. 330 days with a little
// slack; a miss costs one 404.
export const LIVE_WINDOW_DAYS = 330;

// Politeness pacing between outbound requests, per host.
const PACE_LIVE_MS = 200;
const PACE_CC_MS = 250;
const PACE_WAYBACK_MS = 1000;

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isoDate(v) {
  if (typeof v !== "string" || !v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

async function alreadyRunning(sb, name) {
  const rows = await sb(`/jobs?name=eq.${name}&status=eq.running&select=id&limit=1`, { service: true });
  return Array.isArray(rows) && rows.length > 0;
}

async function startJob(sb, name, trigger, metadata) {
  const [job] = await sb(`/jobs`, {
    service: true,
    method: "POST",
    body: { name, trigger, metadata },
    prefer: "return=representation",
  });
  return job;
}

async function finishJob(sb, jobId, { status, rows, metadata, error }) {
  const body = { finished_at: new Date().toISOString(), status, metadata };
  if (typeof rows === "number") body.rows_processed = rows;
  if (error) body.error = String(error.message || error).slice(0, 1000);
  await sb(`/jobs?id=eq.${jobId}`, { service: true, method: "PATCH", body });
}

// ---- indexer ------------------------------------------------------------------

// Months from ARCHIVE_FLOOR_YEAR-01 through the current month, as
// [runKey, cdxParam] pairs — ['wayback:2025-06', '202506'].
export function waybackMonths(now) {
  const out = [];
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  for (let d = new Date(Date.UTC(ARCHIVE_FLOOR_YEAR, 0, 1)); d <= end; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    out.push([`wayback:${y}-${m}`, `${y}${m}`]);
  }
  return out;
}

async function upsertIndexRows(sb, rows) {
  const byKey = new Map();
  for (const r of rows) byKey.set(`${r.id}|${r.source}|${r.captured_at}`, r);
  const unique = [...byKey.values()];
  const CHUNK = 500;
  for (let i = 0; i < unique.length; i += CHUNK) {
    await sb("/nav_archive_index?on_conflict=id,source,captured_at", {
      service: true,
      method: "POST",
      body: unique.slice(i, i + CHUNK).map((r) => ({
        id: r.id,
        source: r.source,
        captured_at: r.captured_at,
        locator: r.locator,
        indexed_at: new Date().toISOString(),
      })),
      prefer: "resolution=merge-duplicates,return=minimal",
      retryTransient: true,
    });
  }
  return unique.length;
}

async function markRun(sb, sourceKey, rowsIndexed, metadata) {
  await sb("/nav_archive_index_runs?on_conflict=source_key", {
    service: true,
    method: "POST",
    body: [{ source_key: sourceKey, indexed_at: new Date().toISOString(), rows_indexed: rowsIndexed, metadata }],
    prefer: "resolution=merge-duplicates,return=minimal",
    retryTransient: true,
  });
}

export async function archiveIndexNav({
  sb,
  trigger = "manual",
  fetcher = fetch,
  sleep = defaultSleep,
  now = () => new Date(),
  maxWallMs = 25 * 60_000,
}) {
  await sweepStaleRunningJobs(sb).catch((e) =>
    console.error("sweepStaleRunningJobs failed (non-fatal):", e.message),
  );
  if (await alreadyRunning(sb, ARCHIVE_INDEX_JOB)) {
    return { status: "skipped", reason: "already_running" };
  }

  const doneRows = await sb("/nav_archive_index_runs?select=source_key", { service: true });
  const done = new Set((doneRows || []).map((r) => r.source_key));
  const job = await startJob(sb, ARCHIVE_INDEX_JOB, trigger, { done_keys: done.size });
  const start = Date.now();
  const stats = {
    cc_crawls_indexed: 0,
    cc_rows: 0,
    wayback_months_indexed: 0,
    wayback_rows: 0,
    wayback_error: null,
    stopped: null,
  };
  const overBudget = () => Date.now() - start > maxWallMs;

  try {
    // ---- Common Crawl: one run key per crawl; crawls are immutable.
    const crawls = await listCcCrawls({ fetcher });
    for (const crawl of crawls) {
      const key = `commoncrawl:${crawl}`;
      if (done.has(key)) continue;
      if (overBudget()) {
        stats.stopped = "wall";
        break;
      }
      await heartbeat(sb, job.id, { step: `commoncrawl ${crawl}` });
      const pages = await fetchCcIndexPageCount(crawl, { fetcher });
      let rowsForCrawl = 0;
      for (let page = 0; page < pages; page += 1) {
        await sleep(PACE_CC_MS);
        const rows = await fetchCcIndexPage(crawl, page, { fetcher });
        rowsForCrawl += await upsertIndexRows(sb, rows);
      }
      await markRun(sb, key, rowsForCrawl, { pages });
      done.add(key);
      stats.cc_crawls_indexed += 1;
      stats.cc_rows += rowsForCrawl;
    }

    // ---- Wayback: one run key per month. The current and previous month
    // are re-pulled every run because captures keep landing for weeks.
    if (!stats.stopped) {
      const months = waybackMonths(now());
      const refresh = new Set(months.slice(-2).map(([k]) => k));
      for (const [key, param] of months) {
        if (done.has(key) && !refresh.has(key)) continue;
        if (overBudget()) {
          stats.stopped = "wall";
          break;
        }
        await heartbeat(sb, job.id, { step: key });
        await sleep(PACE_WAYBACK_MS);
        let rows;
        try {
          rows = await fetchWaybackCdx(param, { fetcher });
        } catch (err) {
          // The Wayback CDX goes offline for hours at a time. Keep what we
          // have; the remaining months are picked up by the next weekly run.
          stats.wayback_error = String(err.message || err).slice(0, 200);
          break;
        }
        const n = await upsertIndexRows(sb, rows);
        await markRun(sb, key, n, null);
        done.add(key);
        stats.wayback_months_indexed += 1;
        stats.wayback_rows += n;
      }
    }

    await finishJob(sb, job.id, { status: "success", rows: stats.cc_rows + stats.wayback_rows, metadata: stats });
    return { id: job.id, status: "success", ...stats };
  } catch (err) {
    await finishJob(sb, job.id, { status: "failed", metadata: stats, error: err });
    throw err;
  }
}

// ---- enrichment drain -----------------------------------------------------

// Build the PATCH body for a recovered ad. `row` is the nav_postings row
// (id, title); `ad` is parseArbeidsplassenAd output; `source` is the
// description_source value.
export function buildFoundUpdate(row, ad, source, matchers, nowIso) {
  const updates = {
    description: ad.description,
    description_source: source,
    archive_result: `found:${source}`,
    archive_checked_at: nowIso,
    detail_fetched_at: nowIso,
    retagged_at: nowIso,
  };
  if (!row.title && ad.title) updates.title = ad.title;
  if (ad.jobTitle) updates.occupation = ad.jobTitle;
  if (ad.county) updates.location_county = ad.county;
  if (ad.applyUrl) updates.apply_url = ad.applyUrl;
  const published = isoDate(ad.published);
  const expires = isoDate(ad.expires);
  // Real publication date beats the feed's sistEndret proxy (for backfilled
  // rows that proxy is NAV's bulk-import timestamp, i.e. wrong by months).
  if (published) updates.posted_at = published;
  if (expires) updates.expires_at = expires;
  const tags = applyTags(`${row.title || ad.title || ""} ${ad.description || ""} ${ad.jobTitle || ""}`, matchers);
  updates.is_ai = tags.is_ai;
  updates.matched_keywords = tags.matched_keywords;
  return updates;
}

// An archived page is a hit only if it carries a description and, when it
// names an id, that id is the posting we asked for.
function usableAd(html, id) {
  const ad = parseArbeidsplassenAd(html);
  if (!ad || !ad.description) return null;
  if (ad.id && ad.id.toLowerCase() !== String(id).toLowerCase()) return null;
  return ad;
}

export async function archiveEnrichNav({
  sb,
  trigger = "manual",
  fetcher = fetch,
  sleep = defaultSleep,
  now = () => new Date(),
  maxWallMs = 60_000,
  liveBudget = 120,
  archiveBudget = 120,
  waybackBudget = 30,
}) {
  await sweepStaleRunningJobs(sb).catch((e) =>
    console.error("sweepStaleRunningJobs failed (non-fatal):", e.message),
  );
  if (await alreadyRunning(sb, ARCHIVE_ENRICH_JOB)) {
    return { status: "skipped", reason: "already_running" };
  }

  // ACTIVE postings that enrichNav hasn't reached yet are its job (the feed
  // API still serves them, and stamps description_source='nav_api'); only
  // rows the API can no longer help get the live-page treatment.
  const liveSince = new Date(now().getTime() - LIVE_WINDOW_DAYS * 86_400_000).toISOString();
  const liveCandidates = await sb(
    `/nav_postings?description=is.null&archive_result=is.null&posted_at=gte.${encodeURIComponent(liveSince)}` +
      `&or=(status.neq.ACTIVE,status.is.null,detail_fetched_at.not.is.null)` +
      `&select=id,title&order=posted_at.desc&limit=${liveBudget}`,
    { service: true },
  );
  const queueRows = await sb(
    `/nav_archive_queue?select=id,title,source,captured_at,locator&order=source.asc,captured_at.desc&limit=${archiveBudget * 4}`,
    { service: true },
  );
  // Group captures per posting, preserving the view's (source, newest) order.
  const queue = new Map();
  for (const r of queueRows || []) {
    if (!queue.has(r.id)) queue.set(r.id, { id: r.id, title: r.title, captures: [] });
    queue.get(r.id).captures.push(r);
  }
  const archiveCandidates = [...queue.values()].slice(0, archiveBudget);

  if (liveCandidates.length === 0 && archiveCandidates.length === 0) {
    return { status: "noop", reason: "no candidates", live_candidates: 0, archive_candidates: 0 };
  }

  const matchers = compileMatchers(await loadActiveKeywords(sb));
  const job = await startJob(sb, ARCHIVE_ENRICH_JOB, trigger, {
    live_candidates: liveCandidates.length,
    archive_candidates: archiveCandidates.length,
  });
  const start = Date.now();
  const stats = {
    live_candidates: liveCandidates.length,
    live_hits: 0,
    live_misses: 0,
    live_failed: 0,
    archive_candidates: archiveCandidates.length,
    archive_hits_commoncrawl: 0,
    archive_hits_wayback: 0,
    archive_misses: 0,
    archive_deferred: 0,
    wayback_rate_limited: false,
    stopped: null,
  };
  const overBudget = () => Date.now() - start > maxWallMs;
  const patchPosting = (id, body) =>
    sb(`/nav_postings?id=eq.${encodeURIComponent(id)}`, { service: true, method: "PATCH", body });

  let processed = 0;
  const total = liveCandidates.length + archiveCandidates.length;
  const tick = async (step) => {
    processed += 1;
    if (processed % 10 === 0 || processed === total) {
      await heartbeat(sb, job.id, { pct: (processed / total) * 100, step });
    }
  };

  try {
    // ---- pass 1: live page
    for (const row of liveCandidates) {
      if (overBudget()) {
        stats.stopped = "wall";
        break;
      }
      const nowIso = now().toISOString();
      try {
        const res = await fetchLiveAdPage(row.id, { fetcher });
        const ad = res.html ? usableAd(res.html, row.id) : null;
        if (ad) {
          await patchPosting(row.id, buildFoundUpdate(row, ad, "live_page", matchers, nowIso));
          stats.live_hits += 1;
        } else if (res.http_status === 404 || res.http_status === 410 || (res.http_status === 200 && !ad)) {
          await patchPosting(row.id, { archive_result: "live_miss", archive_checked_at: nowIso });
          stats.live_misses += 1;
        } else {
          // 429/5xx/network: leave the row untouched for the next tick.
          stats.live_failed += 1;
          if (res.http_status === 429) {
            stats.stopped = "live_rate_limited";
            break;
          }
        }
      } catch (err) {
        stats.live_failed += 1;
        console.error(`archive live ${row.id}: ${err.message}`);
      }
      await tick(`live ${stats.live_hits} hits / ${stats.live_misses} misses`);
      await sleep(PACE_LIVE_MS);
    }

    // ---- pass 2: archived captures
    let waybackUsed = 0;
    for (const cand of archiveCandidates) {
      if (overBudget()) {
        stats.stopped = "wall";
        break;
      }
      const nowIso = now().toISOString();
      let found = null;
      let deferred = false;
      for (const cap of cand.captures) {
        if (found) break;
        try {
          if (cap.source === "commoncrawl") {
            await sleep(PACE_CC_MS);
            const res = await fetchCcWarcRecord(cap.locator, { fetcher });
            if (res.html) found = { ad: usableAd(res.html, cand.id), source: "commoncrawl" };
            else if (res.http_status === 0 || res.http_status >= 500 || res.http_status === 429) deferred = true;
          } else if (cap.source === "wayback") {
            if (stats.wayback_rate_limited || waybackUsed >= waybackBudget) {
              deferred = true;
              continue;
            }
            await sleep(PACE_WAYBACK_MS);
            waybackUsed += 1;
            const res = await fetchWaybackCapture(cap.locator, { fetcher });
            if (res.rateLimited) {
              stats.wayback_rate_limited = true;
              deferred = true;
            } else if (res.html) {
              found = { ad: usableAd(res.html, cand.id), source: "wayback" };
            } else if (res.http_status >= 500) {
              deferred = true;
            }
          }
          if (found && !found.ad) found = null;
        } catch (err) {
          deferred = true;
          console.error(`archive ${cap.source} ${cand.id}: ${err.message}`);
        }
      }
      if (found) {
        await patchPosting(cand.id, buildFoundUpdate(cand, found.ad, found.source, matchers, nowIso));
        if (found.source === "commoncrawl") stats.archive_hits_commoncrawl += 1;
        else stats.archive_hits_wayback += 1;
      } else if (deferred) {
        // Something transient stood in the way — retry on a later tick.
        stats.archive_deferred += 1;
      } else {
        await patchPosting(cand.id, { archive_result: "archive_miss", archive_checked_at: nowIso });
        stats.archive_misses += 1;
      }
      await tick(`archive ${stats.archive_hits_commoncrawl + stats.archive_hits_wayback} hits / ${stats.archive_misses} misses`);
    }

    const rows = stats.live_hits + stats.archive_hits_commoncrawl + stats.archive_hits_wayback;
    await finishJob(sb, job.id, { status: "success", rows, metadata: stats });
    return { id: job.id, status: "success", ...stats };
  } catch (err) {
    await finishJob(sb, job.id, { status: "failed", metadata: stats, error: err });
    throw err;
  }
}
