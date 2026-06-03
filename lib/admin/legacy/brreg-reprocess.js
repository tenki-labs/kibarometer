// lib/admin/legacy/brreg-reprocess.js
// Re-tags every brreg_companies row against the current keyword catalogue.
// Mirror of reprocessNavPostings + retagStorting, with three
// pipeline-specific deltas:
//   1. Brreg has TWO keyword fields per row — name (`navn`) and
//      activity (`aktivitet`) — each tagged independently. The
//      generated column `is_ai_relevant` becomes
//      `has_ai_in_name OR has_ai_in_aktivitet`.
//   2. matched_keywords is split into `matched_keywords_name` and
//      `matched_keywords_aktivitet`, both text[] (not jsonb like media).
//   3. The keyword loader (loadActiveKeywords, domain in (jobs, any))
//      matches what ingestion uses today. If brreg-domain keywords
//      become a thing later, swap both loaders together.
//
// Single-row pattern: this orchestrator owns one `reprocess_brreg_keywords`
// jobs row and heartbeats it directly so the UI banner reflects live
// progress (scanned/updated counts). STOP is implemented by PATCHing
// that same row to non-running; the inter-batch poll trips and the loop
// bails after the current page. Mirrors NAV (reprocessNavPostings) and
// storting (retagStorting) — both single-row, no coordinator.
//
// Chains into refreshBrregSnapshots on success so /admin/oppstart reflects
// the new tag state immediately instead of waiting for the next daily
// 04:45 UTC refresh tick. Failures in the chained refresh are recorded
// in metadata.refresh_error and never roll back the retag.
//
// Tier 1/2 columns are deliberately NOT reset on re-tag — same precedent
// as NAV + media. If is_ai_relevant flips false here, prior LLM data is
// left in place (operator-visible "tag drift" is an accepted caveat).

import {
  applyTags,
  compileMatchers,
  loadActiveKeywords,
} from "./nav-processor.js";
import { heartbeat, sweepStaleRunningJobs } from "./jobs.js";
import { refreshBrregSnapshots } from "./brreg.js";
import { keysetPaginate } from "./keyset-paginate.js";

const REPROCESS_JOB = "reprocess_brreg_keywords";

export async function reprocessBrregCompanies({ sb, trigger = "manual" }) {
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
  let scanned = 0;
  let updated = 0;
  const startedAt = new Date().toISOString();
  await heartbeat(sb, job.id, { step: "scanning brreg_companies" });

  // Helper: STOP button PATCHes our own jobs row to status=failed. Poll
  // it between batches so the loop bails after the current page. Best-
  // effort — a transient PostgREST hiccup is treated as "still running"
  // so we don't false-stop.
  async function selfStopped() {
    try {
      const me = await sb(
        `/jobs?id=eq.${job.id}&select=status&limit=1`,
        { service: true },
      );
      return me[0]?.status && me[0].status !== "running";
    } catch {
      return false;
    }
  }

  let stopped = false;
  try {
    // Keyset pagination over the orgnr PK (was deep OFFSET, which timed out
    // at ~92k rows — see keyset-paginate.js). selfStopped is polled at the
    // top of each page so a user STOP bails before processing further.
    await keysetPaginate(
      sb,
      {
        path:
          `/brreg_companies` +
          `?select=orgnr,navn,aktivitet,has_ai_in_name,has_ai_in_aktivitet,matched_keywords_name,matched_keywords_aktivitet`,
        orderCol: "orgnr",
        pageSize: PAGE,
      },
      async (rows) => {
        if (await selfStopped()) {
          stopped = true;
          await heartbeat(sb, job.id, {
            step: `stopped by user at ${scanned}`,
          });
          return true;
        }
        scanned += rows.length;
        await heartbeat(sb, job.id, {
          step: `scanned ${scanned}, updated ${updated}`,
        });
        for (const r of rows) {
          const nameTag = applyTags(r.navn || "", matchers);
          const aktTag = r.aktivitet
            ? applyTags(r.aktivitet, matchers)
            : { is_ai: false, matched_keywords: [] };

          const prevNameKeywords = Array.isArray(r.matched_keywords_name)
            ? r.matched_keywords_name
            : [];
          const prevAktKeywords = Array.isArray(r.matched_keywords_aktivitet)
            ? r.matched_keywords_aktivitet
            : [];

          const sameName =
            nameTag.is_ai === r.has_ai_in_name &&
            nameTag.matched_keywords.length === prevNameKeywords.length &&
            nameTag.matched_keywords.every((t) =>
              prevNameKeywords.includes(t),
            );
          const sameAkt =
            aktTag.is_ai === r.has_ai_in_aktivitet &&
            aktTag.matched_keywords.length === prevAktKeywords.length &&
            aktTag.matched_keywords.every((t) => prevAktKeywords.includes(t));
          if (sameName && sameAkt) continue;

          await sb(
            `/brreg_companies?orgnr=eq.${encodeURIComponent(r.orgnr)}`,
            {
              service: true,
              method: "PATCH",
              body: {
                has_ai_in_name: nameTag.is_ai,
                has_ai_in_aktivitet: aktTag.is_ai,
                matched_keywords_name: nameTag.matched_keywords,
                matched_keywords_aktivitet: aktTag.matched_keywords,
                retagged_at: startedAt,
              },
              prefer: "return=minimal",
            },
          );
          updated += 1;
        }
      },
    );
    if (stopped) {
      return { id: job.id, status: "stopped", scanned, updated };
    }

    // Chain into snapshot refresh. Without this, /oppstart keeps showing
    // pre-retag counts until the next 04:45 UTC cron tick — a half-day
    // lag if reprocess ran manually. Best-effort: a failure here doesn't
    // roll back the retag (the daily cron still rebuilds on schedule).
    // The refresh job_id + any error are surfaced in metadata for
    // forensics. Mirror of jobs.js:387-411 in reprocessNavPostings.
    let refresh = null;
    let refreshError = null;
    try {
      await heartbeat(sb, job.id, { step: "chaining refreshBrregSnapshots" });
      refresh = await refreshBrregSnapshots({ sb, trigger: "post-reprocess" });
    } catch (e) {
      refreshError = String(e.message || e).slice(0, 500);
      console.error("post-reprocess refreshBrregSnapshots failed:", refreshError);
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
          refresh_job_id: refresh?.job_id ?? null,
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
