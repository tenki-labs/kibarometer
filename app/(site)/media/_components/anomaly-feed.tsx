"use client";

import { useMemo } from "react";

import type {
  MediaAnomalyDaily,
  MediaCategory,
  MediaSnapshotCategoryDaily,
} from "@/lib/supabase";

import { Sparkline, type SparklinePoint } from "./sparkline";

type Props = {
  rows: MediaAnomalyDaily[];
  categoryDaily: MediaSnapshotCategoryDaily[];
  categories: MediaCategory[];
  cutoffMs: number | null;
};

const NB = new Intl.NumberFormat("nb-NO");
const NO_DATE = new Intl.DateTimeFormat("nb-NO", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});

function intensityLabel(z: number): string {
  if (z >= 4) return "Voldsom";
  if (z >= 3) return "Sterk";
  if (z >= 2) return "Markant";
  return "Liten";
}

export function AnomalyFeed({
  rows,
  categoryDaily,
  categories,
  cutoffMs,
}: Props) {
  const labelBySlug = useMemo(
    () => new Map(categories.map((c) => [c.slug, c.label_no])),
    [categories],
  );

  // Group categoryDaily by slug for fast sparkline lookup, dropping rows
  // outside the active range so the sparkline matches the page's window.
  const dailyBySlug = useMemo(() => {
    const cutoff = cutoffMs ?? -Infinity;
    const map = new Map<string, SparklinePoint[]>();
    for (const r of categoryDaily) {
      const t = new Date(r.published_on + "T00:00:00Z").getTime();
      if (t < cutoff) continue;
      const arr = map.get(r.category_slug) ?? [];
      arr.push({ date: r.published_on, value: r.ai_count });
      map.set(r.category_slug, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.date.localeCompare(b.date));
    }
    return map;
  }, [categoryDaily, cutoffMs]);

  const inRange = useMemo(() => {
    const cutoff = cutoffMs ?? -Infinity;
    return rows
      .filter((r) => new Date(r.date + "T00:00:00Z").getTime() >= cutoff)
      .sort((a, b) => {
        if (b.date !== a.date) return b.date.localeCompare(a.date);
        return b.z_score - a.z_score;
      });
  }, [rows, cutoffMs]);

  if (inRange.length === 0) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-md border border-dashed px-6 text-center text-sm text-muted-foreground">
        Ingen kategori-spiker i denne perioden. Mediedekningen ligger
        innenfor forventet variasjon mot 28-dagers rullerende baseline.
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {inRange.map((r) => {
        const date = new Date(r.date + "T00:00:00Z");
        const label = labelBySlug.get(r.category_slug) ?? r.category_slug;
        const points = dailyBySlug.get(r.category_slug) ?? [];
        // Baseline-vs-actual ratio for the inline mini-bar. Capped at 4× so a
        // 30× spike doesn't squash the rest visually.
        const ratio =
          r.baseline_mean > 0
            ? Math.min(4, r.count / r.baseline_mean)
            : 1;
        return (
          <li
            key={`${r.date}-${r.category_slug}`}
            className="flex items-stretch gap-4 rounded-md border bg-card px-4 py-3"
          >
            <div className="flex w-12 shrink-0 flex-col items-center justify-center">
              <span className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-muted-foreground">
                z
              </span>
              <span className="text-2xl font-medium tabular-nums leading-none">
                {r.z_score.toFixed(1).replace(".", ",")}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{label}</span>
                <span className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
                  {NO_DATE.format(date)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {intensityLabel(r.z_score)} spike — {NB.format(r.count)}{" "}
                AI-artikler mot baseline{" "}
                {r.baseline_mean.toFixed(1).replace(".", ",")}.
              </p>
              <div className="mt-1 flex items-center gap-2">
                <div
                  className="h-1.5 w-24 overflow-hidden rounded-full bg-muted"
                  aria-hidden
                >
                  <div
                    className="h-full rounded-full bg-foreground/70"
                    style={{ width: `${(ratio / 4) * 100}%` }}
                  />
                </div>
                <span className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-muted-foreground">
                  {ratio >= 4
                    ? ">4×"
                    : `${ratio.toFixed(1).replace(".", ",")}×`}{" "}
                  baseline
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center text-foreground/70">
              <Sparkline
                points={points}
                width={140}
                height={40}
                highlightDate={r.date}
                ariaLabel={`Daglig volum for ${label} med spike markert`}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
