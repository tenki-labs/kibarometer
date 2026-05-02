// app/_components/charts.tsx
// Hand-rolled SVG charts. Server-rendered, zero client JS, zero deps.
// If/when interactive tooltips become necessary, swap to uplot (~40KB) — for
// v1 the SSR'd SVGs do everything we need including embeddability via iframe.

import type { SnapshotMonthly } from "@/lib/supabase";

// Threshold below which row counts are considered too small to publish a
// percentage off. Lives here as the single source of truth — UI components
// add a "lavt utvalg" badge below this line.
export const LOW_SAMPLE_THRESHOLD = 10;

// ---- Sparkline -----------------------------------------------------------

type SparklineProps = {
  values: number[];
  width?: number;
  height?: number;
  /** Aria label for screen readers; the chart itself is decorative. */
  label?: string;
};

export function Sparkline({
  values,
  width = 160,
  height = 36,
  label = "Trend siste 30 dager",
}: SparklineProps) {
  if (values.length === 0) {
    return (
      <svg width={width} height={height} role="img" aria-label={`${label}: ingen data`} />
    );
  }
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;
  const points = values
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
    >
      <polyline
        points={points}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ---- Trend chart ---------------------------------------------------------

type TrendMode = "absolute" | "share";

type TrendChartProps = {
  monthly: SnapshotMonthly[];
  mode: TrendMode;
  height?: number;
  label?: string;
};

const NO_MONTHS_SHORT = ["jan", "feb", "mar", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "des"];

export function TrendChart({
  monthly,
  mode,
  height = 240,
  label,
}: TrendChartProps) {
  const ariaLabel = label ?? (mode === "share"
    ? "AI-andel av alle stillinger, månedlig"
    : "Antall AI-stillinger per måned");

  if (monthly.length === 0) {
    return (
      <div className="chart-empty" role="img" aria-label={`${ariaLabel}: ingen data`}>
        Ingen data ennå.
      </div>
    );
  }

  // Sort ascending by month for a left-to-right time axis.
  const rows = [...monthly].sort((a, b) =>
    a.posted_month < b.posted_month ? -1 : a.posted_month > b.posted_month ? 1 : 0
  );
  const series = rows.map((r) =>
    mode === "share"
      ? r.total_count > 0 ? r.ai_count / r.total_count : 0
      : r.ai_count
  );

  const PAD_LEFT = 44;
  const PAD_RIGHT = 12;
  const PAD_TOP = 12;
  const PAD_BOTTOM = 24;
  const width = 720;
  const innerW = width - PAD_LEFT - PAD_RIGHT;
  const innerH = height - PAD_TOP - PAD_BOTTOM;

  const max = Math.max(...series, mode === "share" ? 0.001 : 1);
  const min = 0;
  const stepX = rows.length > 1 ? innerW / (rows.length - 1) : 0;

  const points = series
    .map((v, i) => {
      const x = PAD_LEFT + i * stepX;
      const y = PAD_TOP + innerH - ((v - min) / (max - min || 1)) * innerH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  // Y-axis ticks: 0, mid, max
  const yTicks = [0, max / 2, max].map((v) => ({
    value: v,
    y: PAD_TOP + innerH - ((v - min) / (max - min || 1)) * innerH,
    label: mode === "share" ? `${(v * 100).toFixed(1)}%` : String(Math.round(v)),
  }));

  // X-axis: every Nth month label, ensure first + last shown.
  const xLabelEvery = Math.max(1, Math.ceil(rows.length / 8));
  const xLabels = rows
    .map((r, i) => ({
      i,
      visible: i === 0 || i === rows.length - 1 || i % xLabelEvery === 0,
      text: monthLabel(r.posted_month),
      x: PAD_LEFT + i * stepX,
    }))
    .filter((l) => l.visible);

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
      preserveAspectRatio="none"
    >
      {/* gridlines */}
      {yTicks.map((t, i) => (
        <line
          key={i}
          x1={PAD_LEFT}
          x2={width - PAD_RIGHT}
          y1={t.y}
          y2={t.y}
          stroke="var(--subtle)"
          strokeWidth="1"
        />
      ))}
      {/* y-axis labels */}
      {yTicks.map((t, i) => (
        <text
          key={`yl${i}`}
          x={PAD_LEFT - 6}
          y={t.y + 3}
          textAnchor="end"
          fontFamily="DM Mono, monospace"
          fontSize="10"
          fill="var(--muted)"
        >
          {t.label}
        </text>
      ))}
      {/* line */}
      <polyline
        points={points}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* x-axis labels */}
      {xLabels.map((l) => (
        <text
          key={`xl${l.i}`}
          x={l.x}
          y={height - 6}
          textAnchor={l.i === 0 ? "start" : l.i === rows.length - 1 ? "end" : "middle"}
          fontFamily="DM Mono, monospace"
          fontSize="10"
          fill="var(--muted)"
        >
          {l.text}
        </text>
      ))}
    </svg>
  );
}

function monthLabel(iso: string): string {
  // posted_month is YYYY-MM-01.
  const [y, m] = iso.split("-");
  if (!y || !m) return iso;
  const mi = parseInt(m, 10) - 1;
  const monthName = NO_MONTHS_SHORT[mi] ?? m;
  return `${monthName}${mi === 0 ? ` ${y.slice(2)}` : ""}`;
}

// ---- Horizontal-bar list -------------------------------------------------

type HBarRow = {
  label: string;
  /** Numerator. Drives the bar width relative to `max`. */
  value: number;
  /** Optional total — when present the bar shows `value / total` and renders
   *  the share next to the count. Used by Geografi/Yrkeskategori. */
  total?: number;
  /** Optional href — when present the row label is a link. */
  href?: string;
  /** Optional secondary text shown right of the value (e.g. YoY %). */
  badge?: string;
};

type HBarListProps = {
  rows: HBarRow[];
  /** Bar scale max. Defaults to the largest value in `rows`. */
  max?: number;
  /** Threshold below which a row is rendered greyed-out with a "lavt utvalg" badge.
   *  Defaults to LOW_SAMPLE_THRESHOLD; pass null to disable. */
  lowSampleThreshold?: number | null;
};

export function HBarList({
  rows,
  max,
  lowSampleThreshold = LOW_SAMPLE_THRESHOLD,
}: HBarListProps) {
  if (rows.length === 0) {
    return <div className="chart-empty">Ingen data ennå.</div>;
  }
  const m = max ?? Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="hbar-list">
      {rows.map((r, i) => {
        const pct = (r.value / m) * 100;
        const lowSample = lowSampleThreshold !== null && r.value < lowSampleThreshold;
        const share = r.total && r.total > 0 ? (r.value / r.total) * 100 : null;
        const labelEl = r.href
          ? <a href={r.href} className="hbar-label-link">{r.label}</a>
          : r.label;
        return (
          <li key={`${r.label}-${i}`} className={lowSample ? "hbar-row low-sample" : "hbar-row"}>
            <div className="hbar-label">{labelEl}</div>
            <div className="hbar-track">
              <div className="hbar-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="hbar-value">
              <span className="hbar-count">{r.value.toLocaleString("nb-NO")}</span>
              {share !== null && (
                <span className="hbar-share"> · {share.toFixed(1)}%</span>
              )}
              {r.badge && <span className="hbar-badge"> · {r.badge}</span>}
              {lowSample && <span className="hbar-low-sample"> · lavt utvalg</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
