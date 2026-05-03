"use server";

import { redirect } from "next/navigation";

import { flashQs } from "@/lib/admin/flash";
import { mlxPing } from "@/lib/admin/mlx";

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
        error: err instanceof Error ? err.message : String(err),
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
