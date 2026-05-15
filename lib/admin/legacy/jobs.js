// lib/admin/legacy/jobs.js
// Orchestration logic for the kibarometer admin Jobber section. Ported
// verbatim from scripts/admin-sections/jobs.js — only the HTML rendering
// (listInner, statusBadge, durationLabel, backfillStateLine) was dropped;
// those are TSX in app/admin/(app)/processes/page.tsx.
//
// Same exports as before: every cron route handler and server action calls
// these. Re-tagging behaviour, sweep semantics, and `jobs` row shape stay
// identical so the post-cutover dashboards and crontab are unaffected.

import {
  fetchFeedentry,
  fetchStillingsfeed,
  fetchStillingsfeedBatch,
} from "./nav-client.js";
import {
  applyTags,
  compileMatchers,
  enrichFromDetail,
  loadActiveKeywords,
  processPayload,
} from "./nav-processor.js";

export const BACKFILL_JOB = "backfill_nav_stillingsfeed";
const REPROCESS_JOB = "reprocess_nav_postings";
const ENRICH_JOB = "enrich_nav_postings";
const SNAPSHOT_JOB = "refresh_nav_snapshots";
const LLM_DISCOVER_JOB = "llm_discover";
const LLM_CLASSIFY_JOB = "llm_classify";
const LLM_REPROCESS_JOB = "llm_reprocess";

// Sweep threshold: any `jobs` row with status='running' older than this is
// treated as an orphan (the admin process died before reaching its terminal
// PATCH). 30 min is comfortably longer than any realistic batch — backfill
// ≤90 s, enrich ≤90 s, snapshot refresh <60 s, reprocess up to ~10 min on
// the largest foreseeable dataset — so legitimate concurrent runs are never
// killed by a sibling's sweep.
const STALE_RUNNING_MS = 30 * 60 * 1000;

// Allowlist of job names eligible for the sweep. New orchestrators must opt
// in explicitly so a new long-running job isn't false-failed by default.
// llm_discover (PR 2) and llm_classify (PR 3) opt in here so the existing
// sweep cadence (every enrich-nav tick, every 15 min) reaps stale tier1/2
// runs without each orchestrator needing to call sweep itself.
// backfill_drain (this PR) is the long-lived coordinator row owned by
// fastForwardAction — if kiba-web restarts mid-drain, the sweep reaps it
// after 30 min so the user can click BACKFILL again.
const SWEEPABLE_JOB_NAMES = [
  BACKFILL_JOB,
  "backfill_drain",
  ENRICH_JOB,
  REPROCESS_JOB,
  "reprocess_media_keywords",
  "reprocess_brreg_keywords",
  "brreg_reprocess_drain",
  SNAPSHOT_JOB,
  LLM_DISCOVER_JOB,
  LLM_CLASSIFY_JOB,
  LLM_REPROCESS_JOB,
  // Storting orchestrators (lib/admin/legacy/storting.js). Opt-in so the
  // shared sweep reaps stale fetch_storting_session / backfill_storting /
  // reprocess_storting_keywords rows whose JS process died before
  // recording a terminal PATCH.
  "fetch_storting_session",
  "backfill_storting",
  "reprocess_storting_keywords",
];

export async function sweepStaleRunningJobs(sb) {
  // Sweep on two axes (OR'd via two separate PATCHes since PostgREST has
  // no native OR over different columns):
  //   1. started_at older than STALE_RUNNING_MS — original semantics, catches
  //      jobs whose process died before any heartbeat landed.
  //   2. last_heartbeat older than HEARTBEAT_STALE_MS — catches jobs that
  //      hung mid-batch (process still alive but stuck).
  const startedCutoff = new Date(Date.now() - STALE_RUNNING_MS).toISOString();
  const heartbeatCutoff = new Date(Date.now() - HEARTBEAT_STALE_MS).toISOString();
  const allowlist = SWEEPABLE_JOB_NAMES.map(encodeURIComponent).join(",");
  const terminal = {
    status: "failed",
    finished_at: new Date().toISOString(),
    error: "swept (process died before recording terminal state)",
  };
  await sb(
    `/jobs?status=eq.running&started_at=lt.${encodeURIComponent(startedCutoff)}&name=in.(${allowlist})`,
    { service: true, method: "PATCH", body: terminal },
  );
  await sb(
    `/jobs?status=eq.running&last_heartbeat=lt.${encodeURIComponent(heartbeatCutoff)}&name=in.(${allowlist})`,
    { service: true, method: "PATCH", body: { ...terminal, error: "swept (heartbeat went silent mid-batch)" } },
  );
}

// PATCH a heartbeat onto an in-flight jobs row. Best-effort — heartbeat
// failures are logged and swallowed so a transient PostgREST hiccup doesn't
// fail the orchestrator. The terminal success/failure PATCH at the end of
// each orchestrator overwrites these fields anyway.
export async function heartbeat(sb, jobId, { pct, step } = {}) {
  if (!jobId) return;
  const body = { last_heartbeat: new Date().toISOString() };
  if (typeof pct === "number" && Number.isFinite(pct)) {
    body.progress_pct = Math.max(0, Math.min(100, pct));
  }
  if (typeof step === "string" && step) body.current_step = step.slice(0, 200);
  try {
    await sb(`/jobs?id=eq.${jobId}`, {
      service: true,
      method: "PATCH",
      body,
      prefer: "return=minimal",
    });
  } catch (e) {
    console.error(`heartbeat ${jobId} failed (non-fatal):`, e.message);
  }
}

// Heartbeat-stale cutoff: a running job whose last_heartbeat is older than
// this is treated as hung. Loose enough to survive a slow NAV roundtrip
// (≤30s observed in practice), tight enough that a truly stuck process is
// reaped before the next cron tick.
const HEARTBEAT_STALE_MS = 5 * 60 * 1000;

// Run a NAV fetch end-to-end. Idempotent in the "data" sense (each run inserts
// a new nav_raw + jobs row) but never mutates earlier rows.
export async function fetchNav({ sb, trigger = "manual" }) {
  const [job] = await sb(`/jobs`, {
    service: true,
    method: "POST",
    body: { name: "fetch_nav_stillingsfeed", trigger },
    prefer: "return=representation",
  });
  await heartbeat(sb, job.id, { step: "fetching NAV feed" });

  try {
    const result = await fetchStillingsfeed();
    await heartbeat(sb, job.id, { pct: 50, step: "tagging postings" });
    const ok = result.http_status >= 200 && result.http_status < 300;
    if (!ok) throw new Error(`NAV feed returned HTTP ${result.http_status}`);

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

    const matchers = compileMatchers(await loadActiveKeywords(sb));
    const upserted = await processPayload({
      sb,
      navRawRow: { id: navRawRow.id, payload: result.payload },
      matchers,
      ingestMode: "live",
    });

    await sb(`/jobs?id=eq.${job.id}`, {
      service: true,
      method: "PATCH",
      body: {
        finished_at: new Date().toISOString(),
        status: "success",
        rows_processed: upserted,
      },
    });

    return {
      id: job.id,
      status: "success",
      rows_processed: upserted,
      http_status: result.http_status,
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

export async function backfillNav({ sb, trigger = "manual" }) {
  await sweepStaleRunningJobs(sb).catch((e) =>
    console.error("sweepStaleRunningJobs failed (non-fatal):", e.message),
  );
  // Only inherit cursor from a successful, fully-PATCHed predecessor. A
  // running sibling's metadata still holds its initial {next_cursor=
  // start_cursor} pre-PATCH value, and swept/failed rows never advance their
  // next_cursor — picking either would silently restart from the wrong
  // cursor (often null), redo the same 50 pages, and write duplicate
  // nav_raw rows. See investigation 2026-05-03.
  const prev = await sb(
    `/jobs?name=eq.${BACKFILL_JOB}&status=eq.success&order=started_at.desc&limit=1&select=metadata`,
    { service: true },
  );
  const prevMeta = prev[0]?.metadata || null;

  // Resume order: in-flight catch-up cursor first, then tail-poll cursor
  // (re-fetch the head page once we've caught up — that's how we discover
  // newly published events), then null (= start from page 1, first run).
  const startCursor =
    prevMeta?.next_cursor || prevMeta?.tail_cursor || null;

  const [job] = await sb(`/jobs`, {
    service: true,
    method: "POST",
    body: {
      name: BACKFILL_JOB,
      trigger,
      metadata: {
        start_cursor: startCursor,
        next_cursor: startCursor,
        completed: false,
      },
    },
    prefer: "return=representation",
  });

  const matchers = compileMatchers(await loadActiveKeywords(sb));
  // Only the historical fast-forward loop produces backfill rows. The
  // daily cron tick and one-off "kick the cron" button-presses both
  // walk the head and produce live rows.
  const ingestMode = trigger === "fast-forward" ? "backfill" : "live";
  await heartbeat(sb, job.id, { step: "starting backfill batch" });

  try {
    let pageNo = 0;
    const maxPages = 50;
    const summary = await fetchStillingsfeedBatch({
      cursor: startCursor,
      maxPages,
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
          ingestMode,
        });
        pageNo += 1;
        // Pct is bounded by the batch wall clock; we track it as a fraction
        // of maxPages so the UI shows monotonic progress within the batch.
        await heartbeat(sb, job.id, {
          pct: (pageNo / maxPages) * 100,
          step: `fetched page ${pageNo} / ${maxPages} (max)`,
        });
      },
    });

    // Caught-up = next_id was null on the last page → save the head's id as
    // tail_cursor so the next tick re-polls it. Otherwise we're still walking
    // forward → save next_cursor and clear tail_cursor.
    const newMeta = summary.completed
      ? {
          start_cursor: startCursor,
          next_cursor: null,
          tail_cursor: summary.lastPageId,
          completed: true,
          pages_fetched: summary.pagesFetched,
          last_event_at: summary.lastEventAt,
        }
      : {
          start_cursor: startCursor,
          next_cursor: summary.nextCursor,
          tail_cursor: null,
          completed: false,
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
      completed: summary.completed,
      next_cursor: summary.nextCursor,
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

export async function reprocessNavPostings({ sb, trigger = "manual" }) {
  await sweepStaleRunningJobs(sb).catch((e) =>
    console.error("sweepStaleRunningJobs failed (non-fatal):", e.message),
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
  await heartbeat(sb, job.id, { step: "scanning postings" });
  try {
    for (;;) {
      const rows = await sb(
        `/nav_postings?select=id,title,description,is_ai,matched_keywords&order=ingested_at.asc&limit=${PAGE}&offset=${offset}`,
        { service: true },
      );
      if (rows.length === 0) break;
      scanned += rows.length;
      // We don't know the total upfront; emit step text + bump heartbeat.
      // Pct stays null so the UI shows an indeterminate bar.
      await heartbeat(sb, job.id, {
        step: `scanned ${scanned}, updated ${updated}`,
      });
      for (const r of rows) {
        const text = `${r.title || ""} ${r.description || ""}`;
        const tags = applyTags(text, matchers);
        const same =
          tags.is_ai === r.is_ai &&
          tags.matched_keywords.length === (r.matched_keywords || []).length &&
          tags.matched_keywords.every((t) =>
            (r.matched_keywords || []).includes(t),
          );
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

    // Chain into snapshot refresh. Without this, /arbeidsmarked keeps
    // showing the pre-retag counts until the next 04:00 UTC cron tick,
    // which can be a half-day lag if reprocess ran manually. Best-effort
    // — a failure here doesn't roll back the reprocess (the daily cron
    // still rebuilds on schedule). Failures are surfaced in the reprocess
    // job's metadata for forensics.
    let refresh = null;
    let refreshError = null;
    try {
      await heartbeat(sb, job.id, { step: "chaining refreshSnapshots" });
      refresh = await refreshSnapshots({ sb, trigger: "post-reprocess" });
    } catch (e) {
      refreshError = String(e.message || e).slice(0, 500);
      console.error("post-reprocess refreshSnapshots failed:", refreshError);
    }

    await sb(`/jobs?id=eq.${job.id}`, {
      service: true,
      method: "PATCH",
      body: {
        finished_at: new Date().toISOString(),
        status: "success",
        rows_processed: updated,
        metadata: {
          scanned,
          updated,
          refresh_job_id: refresh?.id ?? null,
          refresh_error: refreshError,
        },
      },
    });
    return {
      id: job.id,
      status: "success",
      scanned,
      updated,
      refresh: refresh ?? null,
    };
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

export async function enrichNav({ sb, trigger = "manual" }) {
  await sweepStaleRunningJobs(sb).catch((e) =>
    console.error("sweepStaleRunningJobs failed (non-fatal):", e.message),
  );
  const MAX_FETCHES = 200;
  const MAX_WALL_MS = 60_000;

  const candidates = await sb(
    `/nav_postings?status=eq.ACTIVE&detail_fetched_at=is.null&select=id,title&order=posted_at.desc&limit=${MAX_FETCHES}`,
    { service: true },
  );
  if (candidates.length === 0) {
    return {
      status: "noop",
      reason: "no candidates",
      enriched: 0,
      fetched: 0,
      candidates: 0,
      inactive: 0,
      failed: 0,
    };
  }

  const matchers = compileMatchers(await loadActiveKeywords(sb));
  const [job] = await sb(`/jobs`, {
    service: true,
    method: "POST",
    body: {
      name: ENRICH_JOB,
      trigger,
      metadata: { candidates: candidates.length },
    },
    prefer: "return=representation",
  });

  const start = Date.now();
  let fetched = 0;
  let enriched = 0;
  let inactive = 0;
  let failed = 0;
  await heartbeat(sb, job.id, {
    pct: 0,
    step: `0 / ${candidates.length} candidates`,
  });

  try {
    for (let idx = 0; idx < candidates.length; idx += 1) {
      const c = candidates[idx];
      if (Date.now() - start > MAX_WALL_MS) break;
      const now = new Date().toISOString();
      try {
        const res = await fetchFeedentry(c.id);
        fetched += 1;
        if (res.http_status < 200 || res.http_status >= 300) {
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
          await sb(`/nav_postings?id=eq.${encodeURIComponent(c.id)}`, {
            service: true,
            method: "PATCH",
            body: { status: detail.status, detail_fetched_at: now },
          });
          inactive += 1;
          continue;
        }

        const updates = enrichFromDetail(detail);
        if (updates.posted_at === undefined) delete updates.posted_at;
        const tags = applyTags(
          `${c.title || ""} ${updates.description || ""} ${updates.occupation || ""}`,
          matchers,
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
        console.error(`enrich ${c.id}: ${err.message}`);
      }
      // One heartbeat per candidate would be excessive (200 PATCHes per
      // batch). Throttle to every 10 — still smooth in the UI.
      if ((idx + 1) % 10 === 0 || idx === candidates.length - 1) {
        await heartbeat(sb, job.id, {
          pct: ((idx + 1) / candidates.length) * 100,
          step: `${idx + 1} / ${candidates.length} candidates · ${enriched} enriched, ${failed} failed`,
        });
      }
    }

    await sb(`/jobs?id=eq.${job.id}`, {
      service: true,
      method: "PATCH",
      body: {
        finished_at: new Date().toISOString(),
        status: "success",
        rows_processed: enriched,
        metadata: {
          candidates: candidates.length,
          fetched,
          enriched,
          inactive,
          failed,
        },
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

export async function refreshSnapshots({ sb, trigger = "manual" }) {
  await sweepStaleRunningJobs(sb).catch((e) =>
    console.error("sweepStaleRunningJobs failed (non-fatal):", e.message),
  );
  const [job] = await sb(`/jobs`, {
    service: true,
    method: "POST",
    body: { name: SNAPSHOT_JOB, trigger },
    prefer: "return=representation",
  });
  await heartbeat(sb, job.id, { step: "calling refresh_all_snapshots()" });

  try {
    await sb("/rpc/refresh_all_snapshots", {
      service: true,
      method: "POST",
      body: {},
    });

    // Refresh the LLM phrase aggregation alongside the dashboard snapshots
    // so the candidate review queue (PR 6) reflects the same 24-hour cycle.
    // Best-effort: a failure here shouldn't roll back the snapshot refresh —
    // the function is also called from each review action in /admin/keywords/
    // candidates, so the queue catches up on the next operator interaction.
    let candidatesRefreshError = null;
    await heartbeat(sb, job.id, { step: "calling refresh_keyword_candidates()" });
    try {
      await sb("/rpc/refresh_keyword_candidates", {
        service: true,
        method: "POST",
        body: {},
      });
    } catch (e) {
      candidatesRefreshError = String(e.message || e).slice(0, 500);
      console.error(
        "refresh_keyword_candidates failed (non-fatal):",
        candidatesRefreshError,
      );
    }

    // Skill-category snapshot driving the home-page chart (PR 9). Same
    // best-effort pattern: failures here don't roll back the dashboard
    // snapshots — yesterday's row stays valid until the next successful
    // refresh tick.
    let skillSnapshotError = null;
    await heartbeat(sb, job.id, { step: "calling refresh_snapshot_skill_categories()" });
    try {
      await sb("/rpc/refresh_snapshot_skill_categories", {
        service: true,
        method: "POST",
        body: {},
      });
    } catch (e) {
      skillSnapshotError = String(e.message || e).slice(0, 500);
      console.error(
        "refresh_snapshot_skill_categories failed (non-fatal):",
        skillSnapshotError,
      );
    }

    const [hl] = await sb(
      "/snapshot_headline?order=computed_for.desc&limit=1&select=ai_count_7d,ai_count_30d,ai_share_30d,computed_for",
      { service: true },
    );

    await sb(`/jobs?id=eq.${job.id}`, {
      service: true,
      method: "PATCH",
      body: {
        finished_at: new Date().toISOString(),
        status: "success",
        rows_processed: hl?.ai_count_30d ?? 0,
        metadata: {
          headline: hl || null,
          candidates_refresh_error: candidatesRefreshError,
          skill_snapshot_error: skillSnapshotError,
        },
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
