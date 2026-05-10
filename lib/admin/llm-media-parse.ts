// Pure parsers + validators for the media LLM pipeline. No server-only
// imports, no DB / network deps — tested in isolation. The orchestrators
// in llm-media-tier1.ts / llm-media-tier2.ts re-export and use these.

const MIN_PHRASE_LEN = 2;
const MAX_PHRASE_LEN = 80;
const MAX_PHRASES_PER_ARTICLE = 12;

export const STANCE_VALUES = [
  "enthusiastic",
  "alarmed",
  "critical",
  "neutral-explainer",
  "policy-debate",
  "personal-story",
] as const;
export type Stance = (typeof STANCE_VALUES)[number];
export const STANCE_SET: Set<string> = new Set(STANCE_VALUES);

export type Phrase = { text: string };
export type Tier1Output = {
  phrases: Phrase[];
};

export type CategoryAssignment = { slug: string; confidence: number };

export type Tier2Output = {
  categories: CategoryAssignment[];
  stance: Stance | null;
  intensity: number | null;
  rationale: string;
};

export function parseTier1(content: string): Tier1Output | null {
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

  const rawPhrases = (obj as { phrases?: unknown }).phrases;
  if (!Array.isArray(rawPhrases)) {
    return { phrases: [] };
  }
  const phrases: Phrase[] = [];
  for (const p of rawPhrases) {
    if (
      p &&
      typeof p === "object" &&
      typeof (p as { text?: unknown }).text === "string"
    ) {
      phrases.push({ text: (p as { text: string }).text });
    }
  }
  return { phrases };
}

export function validatePhrases(
  phrases: Phrase[],
  headline: string,
): Phrase[] {
  const haystack = headline.toLowerCase();
  const seen = new Set<string>();
  const out: Phrase[] = [];
  for (const p of phrases) {
    if (typeof p?.text !== "string") continue;
    const trimmed = p.text.trim();
    if (trimmed.length < MIN_PHRASE_LEN || trimmed.length > MAX_PHRASE_LEN) {
      continue;
    }
    if (!haystack.includes(trimmed.toLowerCase())) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text: trimmed });
    if (out.length >= MAX_PHRASES_PER_ARTICLE) break;
  }
  return out;
}

export function parseTier2(content: string): Tier2Output | null {
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

  const stanceRaw = (obj as { stance?: unknown }).stance;
  const stance = typeof stanceRaw === "string" ? (stanceRaw as Stance) : null;

  const intensityRaw = (obj as { intensity?: unknown }).intensity;
  const intensity =
    typeof intensityRaw === "number" && Number.isFinite(intensityRaw)
      ? intensityRaw
      : null;

  const rationaleRaw = (obj as { rationale?: unknown }).rationale;
  const rationale = typeof rationaleRaw === "string" ? rationaleRaw : "";

  return { categories, stance, intensity, rationale };
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

// Brace-balanced scan that respects strings + escapes. Cheaper than running
// JSON.parse repeatedly with prefix-trimming and handles trailing prose.
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
