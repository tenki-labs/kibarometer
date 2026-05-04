// lib/palette.ts — Stable color assignments for the /jobbmarked stacked-area
// charts. The shadcn theme tokens (--chart-1..5 in globals.css) are reserved
// for the design system; this file holds the chart-specific 12-slot
// occupation palette and the 5-slot AI sub-category palette.

// Vibrant accent reserved for the AI band (segment 2's bottom band).
export const AI_COLOR = "oklch(0.62 0.22 250)";

// 12 hues evenly spaced for the occupation stack. Same lightness + chroma
// across the set so no single band dominates by saturation alone.
const OCCUPATION_PALETTE = [
  "oklch(0.72 0.13 35)",   // warm orange
  "oklch(0.72 0.13 70)",   // amber
  "oklch(0.72 0.13 110)",  // chartreuse
  "oklch(0.72 0.13 145)",  // mint
  "oklch(0.72 0.13 180)",  // teal
  "oklch(0.72 0.13 215)",  // sky
  "oklch(0.72 0.13 285)",  // violet
  "oklch(0.72 0.13 320)",  // magenta
  "oklch(0.72 0.13 355)",  // rose
  "oklch(0.62 0.10 50)",   // brown
  "oklch(0.62 0.10 200)",  // slate-blue
  "oklch(0.62 0.10 130)",  // moss
];

// Stable occupation -> color mapping. Hashes the category name so the same
// category always lands in the same slot, regardless of fetch order.
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function colorForCategory(category: string): string {
  return OCCUPATION_PALETTE[hash(category) % OCCUPATION_PALETTE.length];
}

// AI sub-category palette. Variations on the AI accent so they read as a
// cohesive family. Order matches taxonomy_categories.sort_order convention.
const SKILL_PALETTE = [
  "oklch(0.55 0.22 250)",
  "oklch(0.62 0.22 270)",
  "oklch(0.62 0.20 230)",
  "oklch(0.68 0.18 290)",
  "oklch(0.55 0.18 210)",
];

export function colorForSkillSlug(slug: string, index: number): string {
  return SKILL_PALETTE[index % SKILL_PALETTE.length];
}
