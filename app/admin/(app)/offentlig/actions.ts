"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";

import { flashQs } from "@/lib/admin/flash";
import { sbFetch } from "@/lib/admin/sb";
import { runStortingTier1 } from "@/lib/admin/llm-storting-tier1";
import { runStortingTier2 } from "@/lib/admin/llm-storting-tier2";
import {
  fetchStorting,
  backfillStorting,
  retagStorting,
} from "@/lib/admin/legacy/storting.js";

const LIST = "/admin/offentlig";

const BURST_K_TIER1 = 100;
const BURST_K_TIER2 = 20;
const BURST_WALL_MS = 4 * 60_000;

// Trigger the snapshot orchestrator. Cheap (truncate+insert across the
// offentlig_snapshot_* tables) — runs in seconds. Doffin sub-functions
// land in a future migration; for now this populates the storting half +
// storting fields of the headline.
export async function refreshSnapshotsAction() {
  try {
    await sbFetch("/rpc/refresh_all_offentlig_snapshots", {
      service: true,
      method: "POST",
      body: {},
      prefer: "return=minimal",
    });
    redirect(`${LIST}${flashQs({ ok: "Snapshots regnet på nytt" })}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`${LIST}${flashQs({ error: msg(err) })}`);
  }
}

// Ad-hoc Stortinget daily fetch — same code path as the 07:00 UTC cron tick.
// Useful for catch-up after a missed cron or to refresh after a keyword
// catalog change. ?sessionId=YYYY-YYYY query param overrides the active session.
export async function runStortingFetchAction(formData: FormData) {
  const sessionRaw = formData.get("sessionId");
  const sessionId =
    typeof sessionRaw === "string" && sessionRaw.trim().length > 0
      ? sessionRaw.trim()
      : null;
  try {
    const r = (await fetchStorting({
      sb: sbFetch,
      trigger: "manual",
      sessionId,
    })) as {
      status: string;
      sesjon_id?: string;
      saker_upserted?: number;
      saker_ai_flagged?: number;
      vedtak_upserted?: number;
      vedtak_orphans_dropped?: number;
    };
    const parts = [
      `Stortinget-fetch ${r.sesjon_id ?? ""}: ${r.saker_upserted ?? 0} saker upsertet`,
      r.saker_ai_flagged != null ? `${r.saker_ai_flagged} AI-flagget` : null,
      r.vedtak_upserted != null ? `${r.vedtak_upserted} vedtak` : null,
      r.vedtak_orphans_dropped
        ? `${r.vedtak_orphans_dropped} foreldreløse vedtak droppet`
        : null,
    ].filter(Boolean);
    redirect(`${LIST}${flashQs({ ok: parts.join(" · ") })}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`${LIST}${flashQs({ error: msg(err) })}`);
  }
}

// Run the historical backfill (sessions 2019-2020 → present, reverse-
// chronological — ~7 sessions covering all of calendar 2020 forward).
// Long-running — spawned via after() so the request returns fast; the
// operator follows progress at /admin/processes.
export async function runStortingBackfillAction() {
  const running = await sbFetch<{ id: string }[]>(
    `/jobs?name=eq.backfill_storting&status=eq.running&select=id&limit=1`,
    { service: true },
  );
  if (running.length > 0) {
    redirect(
      `${LIST}${flashQs({ error: "Stortinget-backfill kjører allerede — se /admin/processes." })}`,
    );
  }
  after(async () => {
    try {
      await backfillStorting({ sb: sbFetch, trigger: "manual" });
    } catch {
      // backfillStorting writes its own failure PATCH on the jobs row.
    }
  });
  redirect(
    `${LIST}${flashQs({ ok: "Stortinget-backfill startet — se /admin/processes for status." })}`,
  );
}

// Re-tag every storting row against the current keyword catalogue. Same
// pattern as media reprocess — run after a keyword promotion / demotion
// on /admin/keywords. Spawned via after() since the corpus is large enough
// that the deferred orchestrator can take several minutes.
export async function reprocessKeywordsAction() {
  const running = await sbFetch<{ id: string }[]>(
    `/jobs?name=eq.reprocess_storting_keywords&status=eq.running&select=id&limit=1`,
    { service: true },
  );
  if (running.length > 0) {
    redirect(
      `${LIST}${flashQs({ error: "Re-tagging av Stortinget-saker kjører allerede." })}`,
    );
  }
  after(async () => {
    try {
      await retagStorting({ sb: sbFetch, trigger: "manual" });
    } catch {
      // retagStorting writes its own failure PATCH.
    }
  });
  redirect(
    `${LIST}${flashQs({ ok: "Re-tagging av Stortinget-saker startet — se /admin/processes for status." })}`,
  );
}

// Burst Tier 1 — drain phrase-extraction backlog faster than ~15/tick cron.
// Stortinget Tier 1 is forward-only on ingest_mode='live'; so on a freshly-
// backfilled DB this is mostly a no-op until daily ingest accrues new rows.
export async function burstStortingTier1Action() {
  try {
    const r = await runStortingTier1({
      sb: sbFetch,
      trigger: "manual",
      k: BURST_K_TIER1,
      wallTimeMs: BURST_WALL_MS,
    });
    redirect(`${LIST}${flashQs({ ok: burstFlash("Stortinget Tier 1", r) })}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`${LIST}${flashQs({ error: msg(err) })}`);
  }
}

// Burst Tier 2 — drain slug-assignment backlog. Gates on is_ai_relevant
// directly (not tier1_completed_at) so this DOES work on backfilled rows.
// Typically the first run after a backfill burst-drains 100s of rows.
export async function burstStortingTier2Action() {
  try {
    const r = await runStortingTier2({
      sb: sbFetch,
      trigger: "manual",
      k: BURST_K_TIER2,
      wallTimeMs: BURST_WALL_MS,
    });
    redirect(`${LIST}${flashQs({ ok: burstFlash("Stortinget Tier 2", r) })}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`${LIST}${flashQs({ error: msg(err) })}`);
  }
}

function burstFlash(
  label: string,
  r: {
    status: string;
    reason?: string;
    metadata?: { processed: number; stopped: string };
  },
): string {
  if (r.status === "skipped") {
    return `${label}: hoppet over (${r.reason ?? "ukjent grunn"})`;
  }
  const m = r.metadata;
  if (!m) return `${label}: kjørt`;
  return `${label}: ${m.processed} prosessert (stoppet: ${m.stopped})`;
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
