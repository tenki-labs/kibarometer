"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";

import { flashQs } from "@/lib/admin/flash";
import { sbFetch } from "@/lib/admin/sb";
import { runMediaTier1 } from "@/lib/admin/llm-media-tier1";
import { runMediaTier2 } from "@/lib/admin/llm-media-tier2";
import { runFetchClassify } from "@/lib/admin/legacy/media-fetch-classify.js";
import { reprocessMediaArticles } from "@/lib/admin/legacy/media-reprocess.js";

const LIST = "/admin/media";

const BURST_K_TIER1 = 100;
const BURST_K_TIER2 = 20;
const BURST_K_FETCH = 200;
const BURST_WALL_MS = 4 * 60_000;

// Trigger the snapshot orchestrator. Cheap (truncate+insert across 5 tables);
// run after a re-tag, a backfill burst, or anything else that materially
// changes the article rows the public dashboard reads.
export async function refreshSnapshotsAction() {
  try {
    await sbFetch("/rpc/refresh_all_media_snapshots", {
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

// Re-tag every media_articles row against the current keyword catalogue.
// Runs in the background via after() — the table is large enough that
// the deferred orchestrator can take many minutes. A re-entrancy guard
// (one running row at a time) prevents two operators racing.
//
// Re-tagging works against the headline only; lede/body_text aren't
// persisted (copyright). is_ai_related may flip false for rows whose
// original match was on body content.
export async function reprocessKeywordsAction() {
  const running = await sbFetch<{ id: string }[]>(
    `/jobs?name=eq.reprocess_media_keywords&status=eq.running&select=id&limit=1`,
    { service: true },
  );
  if (running.length > 0) {
    redirect(
      `${LIST}${flashQs({ error: "Re-tagging kjører allerede." })}`,
    );
  }
  after(async () => {
    try {
      await reprocessMediaArticles({ sb: sbFetch, trigger: "manual" });
    } catch {
      // reprocessMediaArticles writes its own failure PATCH to the jobs row.
    }
  });
  redirect(
    `/admin/keywords${flashQs({ ok: "Re-tagging av medieartikler startet — se /admin/processes for status." })}`,
  );
}

// Burst Tier 1: K=100 / 4-min budget. Same orchestrator as the cron tick;
// just bigger K so the operator can drain a backfill backlog of phrase
// extraction without waiting for ~15-row cron ticks. Operator can fire
// repeatedly until "phrases_persisted" stops growing.
export async function burstTier1Action() {
  try {
    const r = await runMediaTier1({
      sb: sbFetch,
      trigger: "manual",
      k: BURST_K_TIER1,
      wallTimeMs: BURST_WALL_MS,
    });
    redirect(`${LIST}${flashQs({ ok: burstFlash("Tier 1", r) })}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`${LIST}${flashQs({ error: msg(err) })}`);
  }
}

// Burst Tier 2: K=20 / 4-min budget. Slower per-row (~12 s on Gemma 4B).
export async function burstTier2Action() {
  try {
    const r = await runMediaTier2({
      sb: sbFetch,
      trigger: "manual",
      k: BURST_K_TIER2,
      wallTimeMs: BURST_WALL_MS,
    });
    redirect(`${LIST}${flashQs({ ok: burstFlash("Tier 2", r) })}`);
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(`${LIST}${flashQs({ error: msg(err) })}`);
  }
}

// Burst fetch+classify: K=200 / 4-min budget. Bandwidth-bound, not
// LLM-bound — per-source crawl_delay_ms is still respected.
export async function burstFetchClassifyAction() {
  try {
    const r = (await runFetchClassify({
      sb: sbFetch,
      trigger: "manual",
      k: BURST_K_FETCH,
      maxWallMs: BURST_WALL_MS,
    })) as {
      status: string;
      reason?: string;
      fetched?: number;
      ai_count?: number;
      stopped?: string;
    };
    const parts = [
      `Fetch+klassifiser: ${r.fetched ?? 0} URL-er prosessert`,
      r.ai_count != null ? `${r.ai_count} AI-treff` : null,
      r.stopped ? `(stoppet: ${r.stopped})` : null,
    ].filter(Boolean);
    redirect(`${LIST}${flashQs({ ok: parts.join(" · ") })}`);
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
