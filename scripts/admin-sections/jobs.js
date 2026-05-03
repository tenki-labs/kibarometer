// scripts/admin-sections/jobs.js
// Admin section: list job runs + manual triggers for backfill, enrich,
// reprocess, snapshot refresh.
//
// backfillNav is the single ingest path: walks NAV's stillingsfeed forward
// from 2023-06; once it hits the live head (next_id=null) it stops walking
// and starts polling that head page on each cron tick to pick up new events
// as NAV appends them.
import { esc, rawHtml, fmtDateTime, btn, pageHead } from "./shared.js";
import { fetchFeedentry, fetchStillingsfeedBatch } from "../nav/client.js";
import {
  applyTags,
  compileMatchers,
  enrichFromDetail,
  loadActiveKeywords,
  processPayload,
} from "../nav/processor.js";

const BACKFILL_JOB = "backfill_nav_stillingsfeed";
const REPROCESS_JOB = "reprocess_nav_postings";
const ENRICH_JOB = "enrich_nav_postings";
const SNAPSHOT_JOB = "refresh_nav_snapshots";

const FEEDENTRY_BASE = "https://pam-stilling-feed.nav.no";

// Sweep threshold: any `jobs` row with status='running' older than this is
// treated as an orphan (the admin process died before reaching its terminal
// PATCH). 30 min is comfortably longer than any realistic batch — backfill
// ≤90 s, enrich ≤90 s, snapshot refresh <60 s, reprocess up to ~10 min on
// the largest foreseeable dataset — so legitimate concurrent runs are never
// killed by a sibling's sweep.
const STALE_RUNNING_MS = 30 * 60 * 1000;

// Allowlist of job names eligible for the sweep. New orchestrators must opt
// in explicitly so a new long-running job isn't false-failed by default.
const SWEEPABLE_JOB_NAMES = [
  BACKFILL_JOB,
  ENRICH_JOB,
  REPROCESS_JOB,
  SNAPSHOT_JOB,
];

const STATUS_LABEL = { running: "Kjører", success: "OK", failed: "Feilet" };
const TRIGGER_LABEL = { manual: "manuell", cron: "cron" };

function statusBadge(s) {
  const colour = s === "success" ? "#0F8F3C" : s === "failed" ? "#B83A2A" : "#6E6E76";
  return `<span style="display:inline-block;padding:.15rem .55rem;background:${colour};color:white;font:500 .65rem/1 'DM Mono',monospace;text-transform:uppercase;letter-spacing:.14em">${esc(STATUS_LABEL[s] || s)}</span>`;
}

function durationLabel(started, finished) {
  if (!finished) return "—";
  const ms = new Date(finished) - new Date(started);
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 1000)} s`;
}

function backfillStateLine(meta) {
  if (!meta) return "Ikke startet ennå.";
  const last = meta.last_event_at ? ` Siste hendelse: ${esc(fmtDateTime(meta.last_event_at))}.` : "";
  // tail_cursor set = caught up to live head, polling for new events.
  if (meta.tail_cursor) {
    const head = `<code>${esc(String(meta.tail_cursor).slice(0, 8))}…</code>`;
    return `Innhentet — poller hodesiden ${head} for nye hendelser.${last}`;
  }
  // Catch-up phase, walking forward.
  const cursor = meta.next_cursor ? `<code>${esc(String(meta.next_cursor).slice(0, 8))}…</code>` : "<em>start</em>";
  return `Pågår. Neste markør: ${cursor}.${last}`;
}

// Mark abandoned jobs as failed so /admin/jobs doesn't keep showing dead
// "Kjører" entries. Best-effort: a sweep failure must not block the real
// work. Called at the top of every orchestrator and rides the existing cron
// schedule — no separate cron tick needed. Worst-case orphan visibility is
// one cron interval (15 min for backfill, 4×/h for enrich, daily for refresh).
//
// Three filters keep the PATCH precise: status='running' (only orphans),
// started_at older than STALE_RUNNING_MS (never our own freshly-created row),
// and name ∈ SWEEPABLE_JOB_NAMES (never accidentally sweep a future job that
// hasn't opted in). All three together also satisfy pg_safeupdate.
async function sweepStaleRunningJobs(sb) {
  const cutoff = new Date(Date.now() - STALE_RUNNING_MS).toISOString();
  const allowlist = SWEEPABLE_JOB_NAMES.map(encodeURIComponent).join(",");
  await sb(
    `/jobs?status=eq.running&started_at=lt.${encodeURIComponent(cutoff)}&name=in.(${allowlist})`,
    {
      service: true,
      method: "PATCH",
      body: {
        status: "failed",
        finished_at: new Date().toISOString(),
        error: "swept (process died before recording terminal state)",
      },
    }
  );
}

export async function listInner({ sb }) {
  const [rows, latestBackfill, enrichQueue, latestHeadline] = await Promise.all([
    sb(
      `/jobs?select=id,name,trigger,status,started_at,finished_at,rows_processed,error&order=started_at.desc&limit=50`,
      { service: true }
    ),
    sb(
      `/jobs?name=eq.${BACKFILL_JOB}&order=started_at.desc&limit=1&select=metadata,status,started_at`,
      { service: true }
    ),
    sb(
      `/nav_postings?status=eq.ACTIVE&detail_fetched_at=is.null&select=id&limit=1`,
      { service: true, headers: { Prefer: "count=exact" } }
    ).catch(() => []),
    sb(
      `/snapshot_headline?order=computed_for.desc&limit=1&select=computed_for,computed_at,ai_count_7d,ai_count_30d,ai_share_30d`,
      { service: true }
    ).catch(() => []),
  ]);
  const backfillMeta = latestBackfill[0]?.metadata || null;
  const enrichQueueHas = Array.isArray(enrichQueue) && enrichQueue.length > 0;
  const headline = latestHeadline[0] || null;
  const tbody = rows.length === 0
    ? `<tr><td colspan="6" class="empty">Ingen jobber ennå.</td></tr>`
    : rows.map(r => `<tr>
        <td><code>${esc(r.name)}</code></td>
        <td>${statusBadge(r.status)}</td>
        <td>${esc(fmtDateTime(r.started_at))}</td>
        <td>${esc(durationLabel(r.started_at, r.finished_at))}</td>
        <td>${r.rows_processed ?? "—"}</td>
        <td>${esc(TRIGGER_LABEL[r.trigger] || r.trigger)}${r.error ? `<div style="color:#B83A2A;font-size:.78rem;margin-top:.15rem">${esc(r.error.slice(0, 200))}</div>` : ""}</td>
      </tr>`).join("");
  return rawHtml`
    ${pageHead("admin", "Jobber")}
    <div class="card" style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap">
      <div style="flex:1;min-width:200px">
        <div class="eyebrow" style="margin-bottom:.3rem">NAV-innhenting</div>
        <div style="color:var(--muted);font-size:.92rem">Går gjennom feeden fra start (≈ 2023-06) framover. Når den når dagens hodeside, poller den samme side hvert 15. min for nye hendelser. Maks 50 sider eller 60 s per kjøring.</div>
        <div style="margin-top:.4rem;font-size:.92rem">${backfillStateLine(backfillMeta)}</div>
      </div>
      <form method="post" action="/admin/jobs/backfill">
        ${btn({ label: "Kjør batch nå" })}
      </form>
    </div>
    <div class="card" style="margin-top:1rem;display:flex;align-items:center;gap:1rem;flex-wrap:wrap">
      <div style="flex:1;min-width:200px">
        <div class="eyebrow" style="margin-bottom:.3rem">Berikelse av aktive stillinger</div>
        <div style="color:var(--muted);font-size:.92rem">Henter <code>/api/v1/feedentry/{uuid}</code> for ACTIVE stillinger uten beskrivelse, slik at tagging treffer på beskrivelse + yrke (ikke bare tittel). Cron hvert 15. min, maks 200 stillinger / 60 s per batch.</div>
        <div style="margin-top:.4rem;font-size:.92rem">${enrichQueueHas ? "Stillinger venter på berikelse." : "Køen er tom."}</div>
      </div>
      <form method="post" action="/admin/jobs/enrich">
        ${btn({ label: "Beriker batch nå" })}
      </form>
    </div>
    <div class="card" style="margin-top:1rem;display:flex;align-items:center;gap:1rem;flex-wrap:wrap">
      <div style="flex:1;min-width:200px">
        <div class="eyebrow" style="margin-bottom:.3rem">Snapshot-refresh</div>
        <div style="color:var(--muted);font-size:.92rem">Regner ut <code>snapshot_*</code>-tabellene som dashbordet leser. Kjører kl. 04:00 (etter backup). Trigg manuelt etter en re-tag eller stor backfill-burst.</div>
        <div style="margin-top:.4rem;font-size:.92rem">${headline
          ? `Sist regnet: ${esc(fmtDateTime(headline.computed_at))}. AI-stillinger 7d: ${headline.ai_count_7d}, 30d: ${headline.ai_count_30d}, andel 30d: ${(headline.ai_share_30d * 100).toFixed(2)}%.`
          : "Aldri kjørt — kjør én gang for å fylle dashbord-tabellene."}</div>
      </div>
      <form method="post" action="/admin/jobs/refresh-snapshots">
        ${btn({ label: "Regn snapshots nå" })}
      </form>
    </div>
    <div class="card" style="margin-top:1.25rem">
      <table>
        <thead><tr>
          <th>Jobb</th><th>Status</th><th>Startet</th><th>Varighet</th><th>Rader</th><th>Trigger</th>
        </tr></thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>
  `;
}

// Single ingest path. Two phases, one orchestrator:
//   1. Catch-up: walk the feed forward from metadata.next_cursor (or page 1
//      on first run). Each batch processes up to 50 pages or 60 s wall time
//      and persists the next cursor for the following tick to resume.
//   2. Tail-poll: once we hit next_id=null (the live head), persist the
//      current page's id as `tail_cursor`. Subsequent ticks re-fetch that
//      cursor — NAV's docs document that the head's `next_id` becomes
//      non-null when new events arrive, at which point we naturally walk
//      forward and discover them. Either way, re-fetching is idempotent
//      (nav_postings upserts on uuid).
//
// Crash-safe at any point: if a batch dies mid-write, the next tick resumes
// from the last persisted cursor. nav_raw is append-only with no unique
// constraint, so duplicate page rows from a mid-batch crash are harmless.
export async function backfillNav({ sb, trigger = "manual" }) {
  await sweepStaleRunningJobs(sb).catch((e) =>
    console.error("sweepStaleRunningJobs failed (non-fatal):", e.message)
  );
  const prev = await sb(
    `/jobs?name=eq.${BACKFILL_JOB}&order=started_at.desc&limit=1&select=metadata`,
    { service: true }
  );
  const prevMeta = prev[0]?.metadata || null;

  // Resume order: in-flight catch-up cursor first, then tail-poll cursor,
  // then null (= start from page 1, first-run only).
  const startCursor = prevMeta?.next_cursor || prevMeta?.tail_cursor || null;

  const [job] = await sb(`/jobs`, {
    service: true,
    method: "POST",
    body: {
      name: BACKFILL_JOB,
      trigger,
      metadata: { start_cursor: startCursor },
    },
    prefer: "return=representation",
  });

  // Compile matchers once per batch — cheap to build but every keyword row
  // becomes a regex. Phase A's seed has ~70 keywords; recompiling per page
  // would dominate processing time.
  const matchers = compileMatchers(await loadActiveKeywords(sb));

  try {
    const summary = await fetchStillingsfeedBatch({
      cursor: startCursor,
      maxPages: 50,
      maxWallMs: 60_000,
      onPage: async (result) => {
        const [navRawRow] = await sb(`/nav_raw`, {
          service: true,
          method: "POST",
          body: {
            endpoint: result.endpoint,
            params: result.params,
            payload: result.payload,
            http_status: result.http_status,
            duration_ms: result.duration_ms,
          },
          prefer: "return=representation",
        });
        await processPayload({
          sb,
          navRawRow: { id: navRawRow.id, payload: result.payload },
          matchers,
        });
      },
    });

    // Caught-up = next_id was null on the last page → keep the head's id as
    // the tail cursor for the next tick to re-poll. Otherwise we still have
    // pages ahead → save next_cursor.
    const newMeta = summary.completed
      ? {
          start_cursor: startCursor,
          next_cursor: null,
          tail_cursor: summary.lastPageId,
          pages_fetched: summary.pagesFetched,
          last_event_at: summary.lastEventAt,
        }
      : {
          start_cursor: startCursor,
          next_cursor: summary.nextCursor,
          tail_cursor: null,
          pages_fetched: summary.pagesFetched,
          last_event_at: summary.lastEventAt,
        };

    await sb(`/jobs?id=eq.${job.id}`, {
      service: true,
      method: "PATCH",
      body: {
        finished_at: new Date().toISOString(),
        status: "success",
        rows_processed: summary.itemsFetched,
        metadata: newMeta,
      },
    });

    return {
      id: job.id,
      status: "success",
      pages: summary.pagesFetched,
      items: summary.itemsFetched,
      caught_up: summary.completed,
      next_cursor: summary.nextCursor,
      tail_cursor: summary.completed ? summary.lastPageId : null,
    };
  } catch (err) {
    await sb(`/jobs?id=eq.${job.id}`, {
      service: true,
      method: "PATCH",
      body: {
        finished_at: new Date().toISOString(),
        status: "failed",
        error: String(err.message || err).slice(0, 1000),
      },
    });
    throw err;
  }
}

// Re-tag every nav_postings row against the current keyword list. Run after
// editing the keyword catalogue. Walks in pages of 1000, only PATCHes rows
// whose tags actually changed (saves ~99% of writes on a no-op re-tag).
//
// Tagging input is title + description: when the enrichment job has populated
// description, retag picks up the richer recall automatically.
export async function reprocessNavPostings({ sb, trigger = "manual" }) {
  await sweepStaleRunningJobs(sb).catch((e) =>
    console.error("sweepStaleRunningJobs failed (non-fatal):", e.message)
  );
  const matchers = compileMatchers(await loadActiveKeywords(sb));
  const [job] = await sb(`/jobs`, {
    service: true,
    method: "POST",
    body: { name: REPROCESS_JOB, trigger },
    prefer: "return=representation",
  });

  const PAGE = 1000;
  let offset = 0;
  let scanned = 0;
  let updated = 0;
  const startedAt = new Date().toISOString();
  try {
    for (;;) {
      const rows = await sb(
        `/nav_postings?select=id,title,description,is_ai,matched_keywords&order=ingested_at.asc&limit=${PAGE}&offset=${offset}`,
        { service: true }
      );
      if (rows.length === 0) break;
      scanned += rows.length;
      for (const r of rows) {
        const text = `${r.title || ""} ${r.description || ""}`;
        const tags = applyTags(text, matchers);
        const same =
          tags.is_ai === r.is_ai &&
          tags.matched_keywords.length === (r.matched_keywords || []).length &&
          tags.matched_keywords.every((t) => (r.matched_keywords || []).includes(t));
        if (same) continue;
        await sb(`/nav_postings?id=eq.${encodeURIComponent(r.id)}`, {
          service: true,
          method: "PATCH",
          body: {
            is_ai: tags.is_ai,
            matched_keywords: tags.matched_keywords,
            retagged_at: startedAt,
          },
        });
        updated += 1;
      }
      if (rows.length < PAGE) break;
      offset += PAGE;
    }

    await sb(`/jobs?id=eq.${job.id}`, {
      service: true,
      method: "PATCH",
      body: {
        finished_at: new Date().toISOString(),
        status: "success",
        rows_processed: updated,
        metadata: { scanned, updated },
      },
    });
    return { id: job.id, status: "success", scanned, updated };
  } catch (err) {
    await sb(`/jobs?id=eq.${job.id}`, {
      service: true,
      method: "PATCH",
      body: {
        finished_at: new Date().toISOString(),
        status: "failed",
        error: String(err.message || err).slice(0, 1000),
        metadata: { scanned, updated },
      },
    });
    throw err;
  }
}

// Enrich ACTIVE postings with detail (description, occupation, county etc.)
// by GET /api/v1/feedentry/{uuid}. One batch = up to 200 fetches or 60 s wall
// time. Skips INACTIVE responses (NAV strips them to {uuid,status,sistEndret})
// but still marks detail_fetched_at so we don't re-queue them next tick.
//
// Re-tags each enriched row against the richer text (title + description) so
// AI postings hidden in body copy finally get classified.
export async function enrichNav({ sb, trigger = "manual" }) {
  await sweepStaleRunningJobs(sb).catch((e) =>
    console.error("sweepStaleRunningJobs failed (non-fatal):", e.message)
  );
  const MAX_FETCHES = 200;
  const MAX_WALL_MS = 60_000;

  const candidates = await sb(
    `/nav_postings?status=eq.ACTIVE&detail_fetched_at=is.null&select=id,title&order=posted_at.desc&limit=${MAX_FETCHES}`,
    { service: true }
  );
  if (candidates.length === 0) {
    return { status: "noop", reason: "no candidates", enriched: 0, fetched: 0 };
  }

  const matchers = compileMatchers(await loadActiveKeywords(sb));
  const [job] = await sb(`/jobs`, {
    service: true,
    method: "POST",
    body: { name: ENRICH_JOB, trigger, metadata: { candidates: candidates.length } },
    prefer: "return=representation",
  });

  const start = Date.now();
  let fetched = 0;
  let enriched = 0;
  let inactive = 0;
  let failed = 0;

  try {
    for (const c of candidates) {
      if (Date.now() - start > MAX_WALL_MS) break;
      const now = new Date().toISOString();
      try {
        const res = await fetchFeedentry(c.id);
        fetched += 1;
        if (res.http_status < 200 || res.http_status >= 300) {
          // Mark fetched_at so we don't re-try a permanently-broken uuid every
          // tick. To force a re-try, null out detail_fetched_at via SQL.
          await sb(`/nav_postings?id=eq.${encodeURIComponent(c.id)}`, {
            service: true,
            method: "PATCH",
            body: { detail_fetched_at: now },
          });
          failed += 1;
          continue;
        }
        const detail = res.detail || {};
        if (detail.status && detail.status !== "ACTIVE") {
          // Posting flipped to INACTIVE between summary ingest and enrich.
          // Detail returns nothing useful; just record status + dequeue.
          await sb(`/nav_postings?id=eq.${encodeURIComponent(c.id)}`, {
            service: true,
            method: "PATCH",
            body: { status: detail.status, detail_fetched_at: now },
          });
          inactive += 1;
          continue;
        }

        const updates = enrichFromDetail(detail);
        // posted_at is `undefined` when detail had no published date — drop it
        // so we don't clobber the summary value with null.
        if (updates.posted_at === undefined) delete updates.posted_at;
        const tags = applyTags(
          `${c.title || ""} ${updates.description || ""} ${updates.occupation || ""}`,
          matchers
        );
        updates.is_ai = tags.is_ai;
        updates.matched_keywords = tags.matched_keywords;
        updates.detail_fetched_at = now;
        updates.retagged_at = now;

        await sb(`/nav_postings?id=eq.${encodeURIComponent(c.id)}`, {
          service: true,
          method: "PATCH",
          body: updates,
        });
        enriched += 1;
      } catch (err) {
        failed += 1;
        // Don't mark detail_fetched_at on transient failures — let the next
        // tick retry. If a uuid is permanently broken it'll keep failing
        // until we add a max-retry counter; out of scope for v1.
        console.error(`enrich ${c.id}: ${err.message}`);
      }
    }

    await sb(`/jobs?id=eq.${job.id}`, {
      service: true,
      method: "PATCH",
      body: {
        finished_at: new Date().toISOString(),
        status: "success",
        rows_processed: enriched,
        metadata: { candidates: candidates.length, fetched, enriched, inactive, failed },
      },
    });
    return {
      id: job.id,
      status: "success",
      candidates: candidates.length,
      fetched,
      enriched,
      inactive,
      failed,
    };
  } catch (err) {
    await sb(`/jobs?id=eq.${job.id}`, {
      service: true,
      method: "PATCH",
      body: {
        finished_at: new Date().toISOString(),
        status: "failed",
        error: String(err.message || err).slice(0, 1000),
        metadata: { fetched, enriched, inactive, failed },
      },
    });
    throw err;
  }
}

// Refresh all six dashboard snapshot tables in one transaction by calling
// the SQL orchestrator function. Cron at 04:00 daily; manual button on the
// Jobs page for ad-hoc kicks (e.g. after a re-tag or backfill burst).
//
// PostgREST exposes SECURITY DEFINER functions at /rpc/<name>. The function
// itself does the work; this wrapper just records timing + status in `jobs`.
export async function refreshSnapshots({ sb, trigger = "manual" }) {
  await sweepStaleRunningJobs(sb).catch((e) =>
    console.error("sweepStaleRunningJobs failed (non-fatal):", e.message)
  );
  const [job] = await sb(`/jobs`, {
    service: true,
    method: "POST",
    body: { name: SNAPSHOT_JOB, trigger },
    prefer: "return=representation",
  });

  try {
    await sb("/rpc/refresh_all_snapshots", {
      service: true,
      method: "POST",
      body: {},
    });
    // Read back the row count for the refreshed headline so the cron log
    // and the admin UI have something concrete to display.
    const [hl] = await sb(
      "/snapshot_headline?order=computed_for.desc&limit=1&select=ai_count_7d,ai_count_30d,ai_share_30d,computed_for",
      { service: true }
    );

    await sb(`/jobs?id=eq.${job.id}`, {
      service: true,
      method: "PATCH",
      body: {
        finished_at: new Date().toISOString(),
        status: "success",
        rows_processed: hl?.ai_count_30d ?? 0,
        metadata: { headline: hl || null },
      },
    });
    return { id: job.id, status: "success", headline: hl || null };
  } catch (err) {
    await sb(`/jobs?id=eq.${job.id}`, {
      service: true,
      method: "PATCH",
      body: {
        finished_at: new Date().toISOString(),
        status: "failed",
        error: String(err.message || err).slice(0, 1000),
      },
    });
    throw err;
  }
}
