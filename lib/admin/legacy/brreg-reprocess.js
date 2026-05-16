// lib/admin/legacy/brreg-reprocess.js
// Re-tags every brreg_companies row against the current keyword catalogue.
// Mirror of reprocessNavPostings + reprocessMediaArticles, with three
// pipeline-specific deltas:
//   1. Brreg has TWO keyword fields per row — name (`navn`) and
//      activity (`aktivitet`) — each tagged independently. The
//      generated column `is_ai_relevant` becomes
//      `has_ai_in_name OR has_ai_in_aktivitet`.
//   2. matched_keywords is split into `matched_keywords_name` and
//      `matched_keywords_aktivitet`, both text[] (not jsonb like media).
//   3. The keyword loader scopes to (brreg, any) — pillar-symmetric with
//      NAV's (jobs, any) and media's (media, any). brreg.js fetchBrreg /
//      bootstrapBrreg use the same scope so the retag verdict matches the
//      ingest-time verdict. brreg-domain keywords (0040) are now actually
//      consulted; jobs-domain keywords (job titles like "ML Engineer")
//      are intentionally excluded from company-name / aktivitet matching.
//
// Coordinator-row pattern: this orchestrator can take many minutes on
// the full Brreg registry. The action layer wraps this with a
// `brreg_reprocess_drain` coordinator row + STOP support so the UI can
// surface a banner / cancel button while we run.
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

const REPROCESS_JOB = "reprocess_brreg_keywords";

export async function reprocessBrregCompanies({
  sb,
  trigger = "manual",
  coordinatorId = null,
}) {
  await sweepStaleRunningJobs(sb).catch((e) =>
    console.error("sweepStaleRunningJobs failed (non-fatal):", e.message),
  );
  const matchers = compileMatchers(
    await loadActiveKeywords(sb, ["brreg", "any"]),
  );
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
  await heartbeat(sb, job.id, { step: "scanning brreg_companies" });

  // Helper: check if the coordinator row was flipped to a non-running
  // state by the STOP button. Best-effort — a transient PostgREST hiccup
  // is treated as "still running" so we don't false-stop.
  async function coordinatorStopped() {
    if (!coordinatorId) return false;
    try {
      const me = await sb(
        `/jobs?id=eq.${coordinatorId}&select=status&limit=1`,
        { service: true },
      );
      return me[0]?.status && me[0].status !== "running";
    } catch {
      return false;
    }
  }

  try {
    for (;;) {
      if (await coordinatorStopped()) {
        await heartbeat(sb, job.id, { step: `stopped by user at ${scanned}` });
        break;
      }
      const rows = await sb(
        `/brreg_companies` +
          `?select=orgnr,navn,aktivitet,has_ai_in_name,has_ai_in_aktivitet,matched_keywords_name,matched_keywords_aktivitet` +
          `&order=ingested_at.asc&limit=${PAGE}&offset=${offset}`,
        { service: true },
      );
      if (rows.length === 0) break;
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
          nameTag.matched_keywords.every((t) => prevNameKeywords.includes(t));
        const sameAkt =
          aktTag.is_ai === r.has_ai_in_aktivitet &&
          aktTag.matched_keywords.length === prevAktKeywords.length &&
          aktTag.matched_keywords.every((t) => prevAktKeywords.includes(t));
        if (sameName && sameAkt) continue;

        await sb(`/brreg_companies?orgnr=eq.${encodeURIComponent(r.orgnr)}`, {
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
