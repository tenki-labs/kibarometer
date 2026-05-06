"use server";

import { makePromptActions } from "@/lib/admin/prompt-actions";

const { createRevisionAction, setActiveAction } = makePromptActions({
  roles: ["brreg_tier1", "brreg_tier2"] as const,
  list: "/admin/startups/prompts",
  roleLabels: { brreg_tier1: "Tier 1", brreg_tier2: "Tier 2" },
});

export { createRevisionAction, setActiveAction };
