// lib/admin/llm-failure.ts — shared failure classification for the Tier 1/2
// MLX orchestrators (NAV / media / brreg / offentlig).
//
// Why this exists: a *transient* MLX failure (HTTP 502 from a down endpoint, or
// an unreachable Cloudflare tunnel) must NOT consume an item's permanent
// `llm_retry_count` budget. Every tier job selects candidates with
// `llm_retry_count < RETRY_LIMIT`, so bumping retry on a transient failure
// means one MLX outage drives the entire pending backlog past the limit and
// silently drops it from the queue forever — the job reports `queue_empty`
// even though real, un-enriched rows are waiting. (This is exactly how the
// media card went blank in June 2026: ~20 days of MLX downtime poisoned every
// pending AI article to retry_count >= 3.)
//
// Only genuinely item-specific failures — unparseable model output (`parse`) —
// should consume the retry budget. Unknown / non-MlxError failures are treated
// as permanent too, preserving prior behaviour and avoiding infinite retry on
// a deterministic per-row bug.

import { MlxError } from "./mlx-error";

/**
 * True when `err` is a transient infra failure that should be retried freely
 * once MLX recovers, WITHOUT bumping the permanent retry counter.
 *
 * `auth` is intentionally NOT transient here — the orchestrators stop the
 * whole run on auth (token revoked) via a separate branch, so it never reaches
 * the retry-bump decision.
 */
export function isTransientMlxFailure(err: unknown): boolean {
  return (
    err instanceof MlxError &&
    (err.kind === "http" || err.kind === "unreachable")
  );
}
