"use client";

import { useMemo } from "react";

import type { BrregSnapshotFinancialsCohort } from "@/lib/supabase";

type Props = {
  rows: BrregSnapshotFinancialsCohort[];
};

const NB = new Intl.NumberFormat("nb-NO");

function fmtNok(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (Math.abs(n) >= 1_000_000_000) {
    return `${(n / 1_000_000_000).toFixed(1).replace(".", ",")} mrd kr`;
  }
  if (Math.abs(n) >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1).replace(".", ",")} mill kr`;
  }
  if (Math.abs(n) >= 1_000) {
    return `${(n / 1_000).toFixed(0)} k kr`;
  }
  return `${NB.format(n)} kr`;
}

function pct(num: number, denom: number): string {
  if (denom === 0) return "—";
  return `${Math.round((num / denom) * 100)} %`;
}

type CardData = {
  cohort_year: number;
  age: number;
  ai_size: number;
  ai_alive: number;
  ai_filing: number;
  ai_median: number | null;
  top_orgnr: string | null;
  top_name: string | null;
  top_revenue: number | null;
  // Survival quartile tint: 0 (worst) .. 3 (best) vs same-year baseline
  // cohort. Tint uses alive_share, which comes from brreg_companies for
  // both populations — honest even though brreg_financials is AI-only.
  tint_bucket: 0 | 1 | 2 | 3 | null;
};

const TINT_CLASSES: Record<number, string> = {
  0: "border-red-300 dark:border-red-900/60",
  1: "border-amber-300 dark:border-amber-900/60",
  2: "border-emerald-300 dark:border-emerald-900/60",
  3: "border-emerald-500 dark:border-emerald-500/70",
};

export function FinancialsCohortCards({ rows }: Props) {
  const cards = useMemo<CardData[]>(() => {
    // Pair AI + baseline rows by cohort_year.
    const byCohort = new Map<
      number,
      {
        ai: BrregSnapshotFinancialsCohort | null;
        baseline: BrregSnapshotFinancialsCohort | null;
      }
    >();
    for (const r of rows) {
      const cur = byCohort.get(r.cohort_year) ?? { ai: null, baseline: null };
      if (r.is_ai_relevant) cur.ai = r;
      else cur.baseline = r;
      byCohort.set(r.cohort_year, cur);
    }

    const ratios: { cohort_year: number; ratio: number | null }[] = [];
    for (const [year, pair] of byCohort) {
      if (!pair.ai) continue;
      const aiAliveShare = pair.ai.cohort_size > 0
        ? pair.ai.alive_count / pair.ai.cohort_size
        : 0;
      const baselineAliveShare =
        pair.baseline && pair.baseline.cohort_size > 0
          ? pair.baseline.alive_count / pair.baseline.cohort_size
          : null;
      const ratio =
        baselineAliveShare !== null && baselineAliveShare > 0
          ? aiAliveShare / baselineAliveShare
          : null;
      ratios.push({ cohort_year: year, ratio });
    }

    // Quartile cutoffs for tinting — use baseline-relative survival ratio.
    const validRatios = ratios
      .map((r) => r.ratio)
      .filter((r): r is number => r !== null)
      .sort((a, b) => a - b);
    const quartile = (r: number): 0 | 1 | 2 | 3 => {
      if (validRatios.length === 0) return 2;
      const idx = Math.floor((validRatios.indexOf(r) / validRatios.length) * 4);
      return Math.min(3, Math.max(0, idx)) as 0 | 1 | 2 | 3;
    };

    const out: CardData[] = [];
    for (const [year, pair] of byCohort) {
      if (!pair.ai) continue;
      const obs = pair.ai.observation_year;
      const ai = pair.ai;
      const ratio = ratios.find((r) => r.cohort_year === year)?.ratio ?? null;
      out.push({
        cohort_year: year,
        age: obs - year,
        ai_size: ai.cohort_size,
        ai_alive: ai.alive_count,
        ai_filing: ai.filing_positive_count,
        ai_median: ai.median_revenue_filing,
        top_orgnr: ai.top_performer_orgnr,
        top_name: ai.top_performer_name,
        top_revenue: ai.top_performer_revenue,
        tint_bucket: ratio !== null ? quartile(ratio) : null,
      });
    }
    return out.sort((a, b) => a.cohort_year - b.cohort_year);
  }, [rows]);

  if (cards.length === 0) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        Ingen kohort-data ennå — krever minst 100 innleverte regnskap per
        observasjonsår.
      </div>
    );
  }

  return (
    <div className="grid h-full w-full auto-rows-fr grid-cols-1 gap-3 overflow-y-auto sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      {cards.map((c) => (
        <article
          key={c.cohort_year}
          className={`flex flex-col gap-2 rounded-md border-2 bg-card p-3 text-sm ${
            c.tint_bucket !== null
              ? TINT_CLASSES[c.tint_bucket]
              : "border-border"
          }`}
        >
          <header>
            <p className="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">
              Årgang {c.cohort_year}
            </p>
            <p className="text-[0.7rem] text-muted-foreground">
              Alder {c.age} år · observert {c.cohort_year + c.age}
            </p>
          </header>
          <div className="space-y-1">
            <p className="text-base font-semibold tabular-nums">
              {NB.format(c.ai_size)} AI-selskap
            </p>
            <p className="text-xs tabular-nums">
              {NB.format(c.ai_alive)} lever ·{" "}
              <span className="font-medium">{pct(c.ai_alive, c.ai_size)}</span>
            </p>
            <p className="text-xs tabular-nums">
              {NB.format(c.ai_filing)} positiv omsetning ·{" "}
              <span className="font-medium">{pct(c.ai_filing, c.ai_size)}</span>
            </p>
          </div>
          <div className="text-xs">
            <p className="text-muted-foreground">Median omsetning</p>
            <p className="font-medium tabular-nums">{fmtNok(c.ai_median)}</p>
          </div>
          {c.top_name && c.top_revenue !== null ? (
            <div className="mt-auto text-[0.7rem]">
              <p className="text-muted-foreground">Toppselskap</p>
              <p className="truncate font-medium" title={c.top_name}>
                {c.top_name}
              </p>
              <p className="tabular-nums text-muted-foreground">
                {fmtNok(c.top_revenue)}
              </p>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}
