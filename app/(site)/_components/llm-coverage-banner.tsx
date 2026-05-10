"use client";

import { useMemo } from "react";

import type { SnapshotTier2CoverageDaily } from "@/lib/supabase";
import { rangeCutoffMs } from "@/app/(site)/_lib/range";
import type { Range } from "@/app/(site)/_components/time-range-toggle";

type Props = {
  rows: SnapshotTier2CoverageDaily[];
  range: Range;
  nowMs: number;
};

const HIDE_AT_PCT = 99.5;
const NB_PCT = new Intl.NumberFormat("nb-NO", {
  style: "percent",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

// AI-only chart sections render this above their content. Reads the
// keyword-flagged-vs-Tier-2-categorized ratio for the active Range and
// displays a one-liner so users can tell sparse-because-unprocessed
// apart from sparse-because-no-data. Hidden once coverage hits 100%.
export function LlmCoverageBanner({ rows, range, nowMs }: Props) {
  const pct = useMemo(() => {
    if (rows.length === 0 || nowMs === 0) return null;
    const cutoffMs = rangeCutoffMs(range, nowMs);
    let ai = 0;
    let done = 0;
    for (const r of rows) {
      const t = new Date(r.date + "T00:00:00Z").getTime();
      if (t < cutoffMs) continue;
      ai += r.ai_total;
      done += r.tier2_done;
    }
    if (ai === 0) return null;
    return (done / ai) * 100;
  }, [rows, range, nowMs]);

  if (pct === null || pct >= HIDE_AT_PCT) return null;

  return (
    <p className="text-[0.7rem] text-muted-foreground">
      LLM-validert: {NB_PCT.format(pct / 100)} av AI-treff i valgt periode.
      Dekningen øker etterhvert som bakgrunns&shy;kategorisering pågår.
    </p>
  );
}
