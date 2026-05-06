"use client";

import { useMemo } from "react";

import type {
  MediaCategory,
  MediaSnapshotCategoryDaily,
} from "@/lib/supabase";

type Props = {
  rows: MediaSnapshotCategoryDaily[];
  categories: MediaCategory[];
  cutoffMs: number;
};

const NB = new Intl.NumberFormat("nb-NO");

export function CategoryList({ rows, categories, cutoffMs }: Props) {
  const ranked = useMemo(() => {
    const totals = new Map<
      string,
      { ai: number; tempSum: number; tempN: number }
    >();
    for (const row of rows) {
      const t = new Date(row.published_on + "T00:00:00Z").getTime();
      if (t < cutoffMs) continue;
      const cur = totals.get(row.category_slug) ?? {
        ai: 0,
        tempSum: 0,
        tempN: 0,
      };
      cur.ai += row.ai_count;
      if (row.temperature !== null && Number.isFinite(row.temperature)) {
        cur.tempSum += row.temperature;
        cur.tempN += 1;
      }
      totals.set(row.category_slug, cur);
    }
    const labelBySlug = new Map(categories.map((c) => [c.slug, c.label_no]));
    const grand = [...totals.values()].reduce((s, v) => s + v.ai, 0);
    return [...totals.entries()]
      .map(([slug, v]) => ({
        slug,
        label: labelBySlug.get(slug) ?? slug,
        ai: v.ai,
        share: grand > 0 ? v.ai / grand : 0,
        temperature: v.tempN > 0 ? v.tempSum / v.tempN : null,
      }))
      .sort((a, b) => b.ai - a.ai);
  }, [rows, categories, cutoffMs]);

  if (ranked.length === 0) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        Ingen kategori-data siste 30 dager.
      </div>
    );
  }

  const max = ranked[0].ai;

  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-[minmax(10rem,16rem)_1fr_auto_auto] items-center gap-3 border-b pb-2 font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
        <span>Kategori</span>
        <span>Volum</span>
        <span className="text-right">AI-artikler</span>
        <span className="text-right">Temperatur</span>
      </div>
      <ul className="flex flex-col">
        {ranked.map((r) => (
          <li
            key={r.slug}
            className="grid grid-cols-[minmax(10rem,16rem)_1fr_auto_auto] items-center gap-3 border-b py-2 text-sm"
          >
            <span className="truncate">{r.label}</span>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-foreground/70"
                style={{ width: `${(r.ai / max) * 100}%` }}
                aria-hidden
              />
            </div>
            <span className="text-right tabular-nums font-mono text-xs">
              {NB.format(r.ai)}
            </span>
            <span className="text-right tabular-nums font-mono text-xs text-muted-foreground">
              {r.temperature === null
                ? "—"
                : `${r.temperature > 0 ? "+" : ""}${r.temperature.toFixed(2).replace(".", ",")}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
