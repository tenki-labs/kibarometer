"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";

import { enrichNav } from "@/lib/admin/legacy/jobs.js";
import {
  archiveEnrichNav,
  archiveIndexNav,
} from "@/lib/admin/legacy/nav-archive.js";
import { runClassify } from "@/lib/admin/llm-classify";
import { runDiscover } from "@/lib/admin/llm-discover";
import { sbFetch } from "@/lib/admin/sb";
import { flashQs } from "@/lib/admin/flash";

const LIST = "/admin/job-market/queue";

const SKIP_LABEL: Record<string, string> = {
  no_api_key: "MLX_API_KEY mangler",
  already_running: "Allerede i gang — hopper over",
};

// Drain the enrichment queue (one batch, ~60s wall budget). enrichNav
// writes its own jobs row, so progress shows on /admin/processes. Same
// orchestrator the cron uses.
export async function runEnrichAction() {
  after(async () => {
    try {
      await enrichNav({ sb: sbFetch, trigger: "manual" });
    } catch {
      // enrichNav writes its own failure PATCH to the jobs row.
    }
  });
  redirect(
    `${LIST}${flashQs({
      ok: "Berikelse-batch startet — følg progresjon på /admin/processes.",
    })}`,
  );
}

// Archive enrichment (one tick, ~60 s wall) — same orchestrator the
// :00/:15/:30/:45 cron runs. Recovers descriptions from the live page /
// Common Crawl / Wayback for postings the feed API can't serve.
export async function runArchiveEnrichAction() {
  after(async () => {
    try {
      await archiveEnrichNav({ sb: sbFetch, trigger: "manual" });
    } catch {
      // archiveEnrichNav writes its own failure PATCH to the jobs row.
    }
  });
  redirect(
    `${LIST}${flashQs({
      ok: "Arkivberikelse-batch startet — følg progresjon på /admin/processes.",
    })}`,
  );
}

// Archive index refresh (minutes) — same orchestrator the Monday cron
// runs. Skips Common Crawl crawls and Wayback months already pulled.
export async function runArchiveIndexAction() {
  after(async () => {
    try {
      await archiveIndexNav({ sb: sbFetch, trigger: "manual" });
    } catch {
      // archiveIndexNav writes its own failure PATCH to the jobs row.
    }
  });
  redirect(
    `${LIST}${flashQs({
      ok: "Arkivindeksering startet — følg progresjon på /admin/processes.",
    })}`,
  );
}

// Tier 1 / Tier 2 burst on the NAV LLM queues. Queue-local versions that
// redirect back to /admin/job-market/queue (the parent's runTier1Action
// redirects to the dashboard). Same underlying orchestrators.
export async function runTier1Action() {
  const skip = await llmPreflight("tier1");
  if (skip) {
    redirect(`${LIST}${flashQs({ ok: skip })}`);
  }
  after(async () => {
    try {
      await runDiscover({ sb: sbFetch, trigger: "manual" });
    } catch {
      // runDiscover writes its own failure PATCH to the jobs row.
    }
  });
  redirect(
    `${LIST}${flashQs({
      ok: "Tier 1-batch startet — følg progresjon på /admin/processes.",
    })}`,
  );
}

export async function runTier2Action() {
  const skip = await llmPreflight("tier2");
  if (skip) {
    redirect(`${LIST}${flashQs({ ok: skip })}`);
  }
  after(async () => {
    try {
      await runClassify({ sb: sbFetch, trigger: "manual" });
    } catch {
      // runClassify writes its own failure PATCH to the jobs row.
    }
  });
  redirect(
    `${LIST}${flashQs({
      ok: "Tier 2-batch startet — følg progresjon på /admin/processes.",
    })}`,
  );
}

async function llmPreflight(
  tier: "tier1" | "tier2",
): Promise<string | null> {
  if (!process.env.MLX_API_KEY) return SKIP_LABEL.no_api_key;
  const jobName = tier === "tier1" ? "llm-discover" : "llm-classify";
  try {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const running = await sbFetch<{ id: string }[]>(
      `/jobs?name=eq.${jobName}&status=eq.running` +
        `&last_heartbeat=gt.${encodeURIComponent(cutoff)}&select=id&limit=1`,
      { service: true },
    );
    if (running.length > 0) return SKIP_LABEL.already_running;
  } catch {
    // If the probe fails, let the orchestrator handle it.
  }
  return null;
}
