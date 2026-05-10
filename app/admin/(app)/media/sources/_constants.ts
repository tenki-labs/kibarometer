// Shared enum tuples for the media-sources surface. Lives in its own
// file (not actions.ts) because Next.js server-action modules ("use
// server") can only export async functions — not constants or types.

export const SOURCE_CATEGORIES = [
  "mainstream",
  "tech",
  "business",
  "policy",
  "other",
] as const;
export type SourceCategory = (typeof SOURCE_CATEGORIES)[number];
