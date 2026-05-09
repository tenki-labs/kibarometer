"use client";

import { useMemo } from "react";

import type {
  MediaCategory,
  MediaSnapshotCategoryDaily,
} from "@/lib/supabase";

import { dateKey } from "@/app/(site)/_lib/range";

import { Sparkline, type SparklinePoint } from "./sparkline";

type Props = {
  rows: MediaSnapshotCategoryDaily[];
  categories: MediaCategory[];
  cutoffMs: number | null;
  monthly: boolean;
};

const NB = new Intl.NumberFormat("nb-NO");

function tempColor(t: number | null): string {
  if (t == null) return "oklch(0.92 0 0)";
  const clamped = Math.max(-1, Math.min(1, t));
  if (clamped >= 0) {
    const l = 0.92 - 0.18 * clamped;
    const c = 0.16 * clamped;
    return `oklch(${l.toFixed(3)} ${c.toFixed(3)} 145)`;
  }
  const a = -clamped;
  const l = 0.92 - 0.18 * a;
  const c = 0.16 * a;
  return `oklch(${l.toFixed(3)} ${c.toFixed(3)} 25)`;
}

function tempLabel(t: number | null): string {
  if (t === null) return "—";
  const sign = t > 0 ? "+" : "";
  return `${sign}${t.toFixed(2).replace(".", ",")}`;
}

type Aggregate = {
  ai: number;
  tempSum: number;
  tempN: number;
  bucketTemps: Map<string, { sum: number; n: number }>;
};

export function CategoryTemperatureList({
  rows,
  categories,
  cutoffMs,
  monthly,
}: Props) {
  const { ranked, bucketKeys } = useMemo(() => {
    const cutoff = cutoffMs ?? -Infinity;
    const bySlug = new Map<string, Aggregate>();
    const allBuckets = new Set<string>();

    for (const row of rows) {
      const t = new Date(row.published_on + "T00:00:00Z").getTime();
      if (t < cutoff) continue;
      const slug = row.category_slug;
      const cur = bySlug.get(slug) ?? {
        ai: 0,
        tempSum: 0,
        tempN: 0,
        bucketTemps: new Map(),
      };
      cur.ai += row.ai_count;
      if (row.temperature !== null && Number.isFinite(row.temperature)) {
        cur.tempSum += row.temperature;
        cur.tempN += 1;
        const key = dateKey(row.published_on, monthly);
        allBuckets.add(key);
        const b = cur.bucketTemps.get(key) ?? { sum: 0, n: 0 };
        b.sum += row.temperature;
        b.n += 1;
        cur.bucketTemps.set(key, b);
      }
      bySlug.set(slug, cur);
    }

    const labelBySlug = new Map(categories.map((c) => [c.slug, c.label_no]));
    const sortedBuckets = [...allBuckets].sort();

    const items = [...bySlug.entries()]
      .map(([slug, v]) => {
        const meanTemp = v.tempN > 0 ? v.tempSum / v.tempN : null;
        const points: SparklinePoint[] = sortedBuckets.map((bk) => {
          const b = v.bucketTemps.get(bk);
          return {
            date: bk,
            value: b && b.n > 0 ? b.sum / b.n : null,
          };
        });
        return {
          slug,
          label: labelBySlug.get(slug) ?? slug,
          ai: v.ai,
          temperature: meanTemp,
          points,
        };
      })
      .filter((r) => r.ai > 0)
      .sort((a, b) => b.ai - a.ai);

    return { ranked: items, bucketKeys: sortedBuckets };
  }, [rows, categories, cutoffMs, monthly]);

  if (ranked.length === 0) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        Ingen kategori-data i denne perioden.
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-[minmax(11rem,18rem)_auto_auto_1fr] items-center gap-4 border-b pb-2 font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
        <span>Kategori</span>
        <span className="text-right">Temperatur</span>
        <span className="text-right">AI-artikler</span>
        <span className="text-right pr-1">Utvikling</span>
      </div>
      <ul className="flex flex-col">
        {ranked.map((r) => (
          <li
            key={r.slug}
            className="grid grid-cols-[minmax(11rem,18rem)_auto_auto_1fr] items-center gap-4 border-b py-2.5 text-sm"
          >
            <span className="truncate">{r.label}</span>
            <span
              className="inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-mono tabular-nums"
              style={{
                background: tempColor(r.temperature),
                color: "oklch(0.2 0 0)",
              }}
              title={
                r.temperature === null
                  ? "Ingen klassifisert dekning i perioden"
                  : `Gjennomsnittstemperatur ${r.temperature.toFixed(2)}`
              }
            >
              {tempLabel(r.temperature)}
            </span>
            <span className="text-right tabular-nums font-mono text-xs text-muted-foreground">
              {NB.format(r.ai)}
            </span>
            <div className="flex justify-end text-foreground/70">
              <Sparkline
                points={r.points}
                width={Math.max(120, Math.min(220, bucketKeys.length * 6))}
                height={36}
                yDomain={[-1, 1]}
                ariaLabel={`Temperatur-utvikling for ${r.label}`}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
