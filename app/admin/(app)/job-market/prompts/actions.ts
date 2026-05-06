"use server";

import { makePromptActions } from "@/lib/admin/prompt-actions";

const { createRevisionAction, setActiveAction } = makePromptActions({
  roles: ["tier1", "tier2"] as const,
  list: "/admin/job-market/prompts",
  roleLabels: { tier1: "Tier 1", tier2: "Tier 2" },
});

export { createRevisionAction, setActiveAction };
