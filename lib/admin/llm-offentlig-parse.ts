// lib/admin/llm-offentlig-parse.ts
// Pure parsers + validators for the /offentlig pillar LLM pipeline. No
// server-only imports, no DB / network deps — tested in isolation. Two
// source tables (storting_saker, doffin_notices) share the same parse
// shape since Tier 2 emits the same JSON contract for both. Tier 1 reuses
// media's shape verbatim (already proven across 4 pillars).
//
// Mirrors lib/admin/llm-brreg-parse.ts — no editorial stance, just
// categories + rationale (parliamentary saker / procurement notices don't
// carry stance the way news articles do).

import {
  parseTier1 as parseMediaTier1,
  validatePhrases as validateMediaPhrases,
  type CategoryAssignment,
  type Phrase,
  type Tier1Output,
} from "@/lib/admin/llm-media-parse";

const MAX_RATIONALE_CHARS = 400;

export type OffentligTier2Output = {
  categories: CategoryAssignment[];
  rationale: string;
};

// Re-export the Tier 1 contract verbatim — same JSON shape as media + brreg.
// The orchestrator runs validatePhrases against the per-pillar haystack
// (sak tittel + flattened emne_liste for storting; description for doffin);
// the validator itself is haystack-agnostic.
export const parseTier1 = parseMediaTier1;
export const validatePhrases = validateMediaPhrases;
export type { Phrase, Tier1Output, CategoryAssignment };

export function parseOffentligTier2(content: string): OffentligTier2Output | null {
  const stripped = stripFences(content);
  const candidate = extractFirstJsonObject(stripped);
  if (!candidate) return null;

  let obj: unknown;
  try {
    obj = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;

  const rawCategories = (obj as { categories?: unknown }).categories;
  const categories: CategoryAssignment[] = [];
  if (Array.isArray(rawCategories)) {
    for (const c of rawCategories) {
      if (
        c &&
        typeof c === "object" &&
        typeof (c as { slug?: unknown }).slug === "string"
      ) {
        const slug = (c as { slug: string }).slug;
        const confidenceRaw = (c as { confidence?: unknown }).confidence;
        const confidence =
          typeof confidenceRaw === "number" ? confidenceRaw : 0.5;
        categories.push({ slug, confidence });
      }
    }
  }

  const rationaleRaw = (obj as { rationale?: unknown }).rationale;
  const rationale = typeof rationaleRaw === "string" ? rationaleRaw : "";

  return {
    categories,
    rationale: rationale.slice(0, MAX_RATIONALE_CHARS),
  };
}

export function clampUnit(c: unknown): number {
  if (typeof c !== "number" || !Number.isFinite(c)) return 0.5;
  if (c < 0) return 0;
  if (c > 1) return 1;
  return c;
}

function stripFences(s: string): string {
  return s
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

// Brace-balanced scan that respects strings + escapes. Mirrors the helper
// in llm-media-parse / llm-brreg-parse (kept here so this module is
// self-contained for tests).
function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i += 1) {
    const ch = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}
