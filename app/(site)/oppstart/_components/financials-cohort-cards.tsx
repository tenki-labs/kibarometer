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
  // cohort_size from brreg_snapshot_financials_cohort. Renamed `active`
  // here because our brreg ingest is forward-only against the active
  // Enhetsregister — companies struck off before bootstrap (2026) are
  // invisible. So cohort_size is a count of *currently active* KI-foretak
  // founded in cohort_year, not the true historical cohort. We drop the
  // "% lever" framing entirely because alive_count / cohort_size is a
  // tautology (≈100 %) for pre-bootstrap years.
  active: number;
  filing_positive: number;
  median_revenue: number | null;
  top_orgnr: string | null;
  top_name: string | null;
  top_revenue: number | null;
};

export function FinancialsCohortCards({ rows }: Props) {
  const cards = useMemo<CardData[]>(() => {
    const out: CardData[] = [];
    for (const r of rows) {
      if (!r.is_ai_relevant) continue;
      out.push({
        cohort_year: r.cohort_year,
        age: r.observation_year - r.cohort_year,
        active: r.cohort_size,
        filing_positive: r.filing_positive_count,
        median_revenue: r.median_revenue_filing,
        top_orgnr: r.top_performer_orgnr,
        top_name: r.top_performer_name,
        top_revenue: r.top_performer_revenue,
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
          className="flex flex-col gap-2 rounded-md border bg-card p-3 text-sm"
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
              {NB.format(c.active)} aktive KI-foretak
            </p>
            <p className="text-xs tabular-nums">
              {NB.format(c.filing_positive)} har innlevert ·{" "}
              <span className="font-medium">
                {pct(c.filing_positive, c.active)}
              </span>
            </p>
          </div>
          <div className="text-xs">
            <p className="text-muted-foreground">Median omsetning blant filere</p>
            <p className="font-medium tabular-nums">{fmtNok(c.median_revenue)}</p>
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
