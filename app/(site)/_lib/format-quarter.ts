// Shared quarter-label formatters for the public scrollers and the
// landing page's BRREG card. Input is the `reg_quarter` column from
// brreg_snapshot_quarterly_ai_growth — always the first day of a
// quarter, so month ∈ {0, 3, 6, 9}.

// "2025-01-01" → "Q1 '25"
export function formatQuarterShort(reg_quarter: string): string {
  const [yyyy, mm] = reg_quarter.split("-");
  const q = Math.floor((Number(mm) - 1) / 3) + 1;
  return `Q${q} '${yyyy.slice(2)}`;
}

// "2025-01-01" → "Q1 2025"
export function formatQuarterLong(reg_quarter: string): string {
  const [yyyy, mm] = reg_quarter.split("-");
  const q = Math.floor((Number(mm) - 1) / 3) + 1;
  return `Q${q} ${yyyy}`;
}

// "2026-01-01" → "Q1 2025" (long form, same quarter one year prior).
export function priorYearQuarter(reg_quarter: string): string {
  const [yyyy, mm] = reg_quarter.split("-");
  return formatQuarterLong(`${Number(yyyy) - 1}-${mm}-01`);
}
