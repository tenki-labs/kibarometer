"use client";

import { useMemo } from "react";

import type { StortingCategory, StortingMonthly } from "../page";

type Props = {
  rows: StortingMonthly[];
  categories: StortingCategory[];
  cutoffMs: number | null;
};

const NB = new Intl.NumberFormat("nb-NO");
const UNCATEGORIZED = "__uncategorized";

type Bar = {
  slug: string;
  label: string;
  count: number;
  share: number; // 0..1, of total AI-flagged saker (incl. uncategorized)
};

// Aggregate per-slug counts across the chosen time window. Uncategorized
// (Tier 2 not yet run) gets its own muted bar at the bottom so the chart
// honestly reflects "what we have so far" rather than overstating the
// share of the categorized slice.
function buildBars(
  rows: StortingMonthly[],
  categories: StortingCategory[],
  cutoffMs: number | null,
): { bars: Bar[]; total: number; uncategorized: number } {
  const labelBySlug = new Map(categories.map((c) => [c.slug, c.label_no]));

  const tally = new Map<string, number>();
  let uncategorized = 0;
  for (const r of rows) {
    const t = new Date(r.computed_for + "T00:00:00Z").getTime();
    if (cutoffMs !== null && t < cutoffMs) continue;
    if (r.category_slug === UNCATEGORIZED) {
      uncategorized += r.ai_count;
      continue;
    }
    tally.set(r.category_slug, (tally.get(r.category_slug) ?? 0) + r.ai_count);
  }

  const total =
    [...tally.values()].reduce((a, b) => a + b, 0) + uncategorized;

  const bars: Bar[] = [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([slug, count]) => ({
      slug,
      label: labelBySlug.get(slug) ?? slug,
      count,
      share: total > 0 ? count / total : 0,
    }));

  return { bars, total, uncategorized };
}

export function DebateCategories({ rows, categories, cutoffMs }: Props) {
  const { bars, total, uncategorized } = useMemo(
    () => buildBars(rows, categories, cutoffMs),
    [rows, categories, cutoffMs],
  );

  if (total === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Ingen AI-flaggede saker i valgt periode.
      </div>
    );
  }

  const max = bars.reduce((m, b) => Math.max(m, b.count), 0);
  const uncategorizedShare = total > 0 ? uncategorized / total : 0;

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto">
      {bars.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Ingen kategorier tildelt ennå — Tier 2 har ikke kjørt på sakene i
          valgt periode.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {bars.map((b) => (
            <div key={b.slug} className="flex items-center gap-3">
              <div className="w-40 shrink-0 text-sm" title={b.slug}>
                {b.label}
              </div>
              <div className="relative h-6 flex-1 rounded-sm bg-muted/40">
                <div
                  className="absolute left-0 top-0 h-full rounded-sm bg-primary/70"
                  style={{ width: max > 0 ? `${(b.count / max) * 100}%` : "0%" }}
                />
              </div>
              <div className="w-28 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {NB.format(b.count)}{" "}
                <span className="text-[0.7rem]">
                  ({(b.share * 100).toFixed(0)}%)
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {uncategorized > 0 ? (
        <p className="border-t pt-3 text-xs text-muted-foreground">
          <strong>{NB.format(uncategorized)}</strong> saker (
          {(uncategorizedShare * 100).toFixed(0)}%) er AI-flagget, men ennå
          ikke kategorisert av Tier 2-LLMen. De vises ikke i listen over og
          forklarer hvorfor søylesummene ikke nødvendigvis er like det totale
          AI-volumet.
        </p>
      ) : null}
    </div>
  );
}
