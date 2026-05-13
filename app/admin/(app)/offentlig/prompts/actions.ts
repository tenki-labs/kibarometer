"use server";

import { makePromptActions } from "@/lib/admin/prompt-actions";

const { createRevisionAction, setActiveAction } = makePromptActions({
  roles: ["offentlig_storting_tier1", "offentlig_storting_tier2"] as const,
  list: "/admin/offentlig/prompts",
  roleLabels: {
    offentlig_storting_tier1: "Stortinget Tier 1",
    offentlig_storting_tier2: "Stortinget Tier 2",
  },
});

export { createRevisionAction, setActiveAction };
