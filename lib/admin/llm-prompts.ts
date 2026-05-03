// lib/admin/llm-prompts.ts — load active LLM prompts from the DB.
// Shared by lib/admin/llm-discover.ts (tier1) and lib/admin/llm-classify.ts
// (tier2). Migration 0018 created the table + the partial unique index that
// enforces "one active prompt per role".

import "server-only";

import { sbFetch } from "@/lib/admin/sb";

export type LlmPromptRole = "tier1" | "tier2";

export type LlmPrompt = {
  id: string;
  role: LlmPromptRole;
  body: string;
  examples: unknown;
  active: boolean;
  created_at: string;
};

export async function loadActivePrompt(
  sb: typeof sbFetch,
  role: LlmPromptRole,
): Promise<LlmPrompt | null> {
  const rows = await sb<LlmPrompt[]>(
    `/llm_prompts?role=eq.${role}&active=is.true` +
      `&select=id,role,body,examples,active,created_at&limit=1`,
    { service: true },
  );
  return rows[0] ?? null;
}
