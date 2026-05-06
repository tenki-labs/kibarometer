"use client";

import { useMemo } from "react";

import type { BrregSnapshotDaily } from "@/lib/supabase";

export type NaceCategoryLabel = {
  slug: string;
  label_no: string;
};

type Props = {
  rows: BrregSnapshotDaily[];
  labels: NaceCategoryLabel[];
  cutoffMs: number;
};

const NB = new Intl.NumberFormat("nb-NO");
const SAMPLE_FLOOR = 25;

export function CategoryList({ rows, labels, cutoffMs }: Props) {
  const ranked = useMemo(() => {
    const totals = new Map<string, { count: number; ai: number }>();
    for (const row of rows) {
      const t = new Date(row.registrert_dato + "T00:00:00Z").getTime();
      if (t < cutoffMs) continue;
      const cur = totals.get(row.nace_category_slug) ?? { count: 0, ai: 0 };
      cur.count += row.count;
      cur.ai += row.ai_relevant_count;
      totals.set(row.nace_category_slug, cur);
    }
    const labelBySlug = new Map(labels.map((l) => [l.slug, l.label_no]));
    return [...totals.entries()]
      .map(([slug, v]) => ({
        slug,
        label: labelBySlug.get(slug) ?? slug,
        count: v.count,
        ai: v.ai,
        share: v.count > 0 ? v.ai / v.count : 0,
        lowSample: v.count < SAMPLE_FLOOR,
      }))
      .sort((a, b) => {
        // Primary: AI share desc; demote low-sample categories to the bottom.
        if (a.lowSample && !b.lowSample) return 1;
        if (!a.lowSample && b.lowSample) return -1;
        return b.share - a.share;
      });
  }, [rows, labels, cutoffMs]);

  if (ranked.length === 0) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        Ingen kategori-data siste 30 dager.
      </div>
    );
  }

  const maxShare = Math.max(...ranked.map((r) => r.share), 0.001);

  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-[minmax(10rem,16rem)_1fr_auto_auto] items-center gap-3 border-b pb-2 font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
        <span>Kategori</span>
        <span>AI-andel</span>
        <span className="text-right">AI-rel.</span>
        <span className="text-right">Totalt</span>
      </div>
      <ul className="flex flex-col">
        {ranked.map((r) => (
          <li
            key={r.slug}
            className={`grid grid-cols-[minmax(10rem,16rem)_1fr_auto_auto] items-center gap-3 border-b py-2 text-sm ${r.lowSample ? "opacity-55" : ""}`}
          >
            <span className="truncate">
              {r.label}
              {r.lowSample ? (
                <span className="ml-2 font-mono text-[0.6rem] uppercase tracking-[0.14em] text-muted-foreground">
                  lavt utvalg
                </span>
              ) : null}
            </span>
            <div className="flex items-center gap-2">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-foreground/70"
                  style={{ width: `${(r.share / maxShare) * 100}%` }}
                  aria-hidden
                />
              </div>
              <span className="w-12 text-right tabular-nums font-mono text-xs">
                {(r.share * 100).toFixed(1).replace(".", ",")} %
              </span>
            </div>
            <span className="text-right tabular-nums font-mono text-xs">
              {NB.format(r.ai)}
            </span>
            <span className="text-right tabular-nums font-mono text-xs text-muted-foreground">
              {NB.format(r.count)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
