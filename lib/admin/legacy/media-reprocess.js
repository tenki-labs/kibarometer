// lib/admin/legacy/media-reprocess.js
// Re-tags every media_articles row against the current keyword catalogue.
// Mirror of reprocessNavPostings in jobs.js, with three deltas:
//   1. Loads media-domain keywords (loadActiveMediaKeywords).
//   2. media_articles only persists `headline` (not lede / body_text — by
//      design, for copyright). The haystack is therefore the headline
//      only, which is strictly weaker than ingestion-time tagging. Some
//      rows whose ORIGINAL match was on body content will flip
//      is_ai_related = false here. Operators should treat this as
//      "re-tag against what we still have" rather than "re-run the
//      original classifier".
//   3. matched_keywords is jsonb on media_articles (not text[]), so
//      diff/serialization treats it as a JSON array of strings.
//
// Tier 1/2 columns are deliberately NOT reset on re-tag — same precedent
// as NAV. If is_ai_related flips false here, prior LLM data is left in
// place (operator-visible "tag drift" is an accepted caveat).

import { applyTags, compileMatchers } from "./nav-processor.js";
import { loadActiveMediaKeywords } from "./media-processor.js";
import { heartbeat, sweepStaleRunningJobs } from "./jobs.js";

const REPROCESS_JOB = "reprocess_media_keywords";

export async function reprocessMediaArticles({ sb, trigger = "manual" }) {
  await sweepStaleRunningJobs(sb).catch((e) =>
    console.error("sweepStaleRunningJobs failed (non-fatal):", e.message),
  );
  const matchers = compileMatchers(await loadActiveMediaKeywords(sb));
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
  await heartbeat(sb, job.id, { step: "scanning articles" });
  try {
    for (;;) {
      const rows = await sb(
        `/media_articles?deleted_at=is.null` +
          `&select=id,headline,is_ai_related,matched_keywords` +
          `&order=id.asc&limit=${PAGE}&offset=${offset}`,
        { service: true },
      );
      if (rows.length === 0) break;
      scanned += rows.length;
      await heartbeat(sb, job.id, {
        step: `scanned ${scanned}, updated ${updated}`,
      });
      for (const r of rows) {
        const haystack = r.headline ? String(r.headline) : "";
        const tags = applyTags(haystack, matchers);
        const prevKeywords = Array.isArray(r.matched_keywords)
          ? r.matched_keywords
          : [];
        const same =
          tags.is_ai === r.is_ai_related &&
          tags.matched_keywords.length === prevKeywords.length &&
          tags.matched_keywords.every((t) => prevKeywords.includes(t));
        if (same) continue;
        await sb(`/media_articles?id=eq.${encodeURIComponent(r.id)}`, {
          service: true,
          method: "PATCH",
          body: {
            is_ai_related: tags.is_ai,
            matched_keywords: tags.matched_keywords,
            match_method: tags.is_ai ? "keyword" : null,
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
