"use server";

import { redirect } from "next/navigation";

import { flashQs } from "@/lib/admin/flash";
import { mlxPing } from "@/lib/admin/mlx";

// /admin/llm is the cross-pipeline LLM-health (diagnostics) surface. The
// Tier 1 / Tier 2 burst triggers moved to /admin/job-market in PR 2 so each
// pipeline's manual triggers live on its own hub. This page keeps the
// connectivity ping only — it's the only action that's actually about
// "the LLM endpoint" rather than "this pipeline's queue".

export async function pingAction() {
  try {
    const result = await mlxPing();
    if (result.ok) {
      redirect(
        `/admin/llm${flashQs({
          ok: result.modelId
            ? `Ping OK · modell: ${result.modelId}`
            : "Ping OK",
        })}`,
      );
    }
    redirect(
      `/admin/llm${flashQs({
        error: result.error ?? "Ukjent feil",
      })}`,
    );
  } catch (err) {
    if (isRedirect(err)) throw err;
    redirect(
      `/admin/llm${flashQs({
        error: msg(err),
      })}`,
    );
  }
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
