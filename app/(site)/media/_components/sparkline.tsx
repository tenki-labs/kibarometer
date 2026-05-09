"use client";

import { useMemo } from "react";
import { Line, LineChart, ReferenceDot, YAxis } from "recharts";

export type SparklinePoint = { date: string; value: number | null };

type Props = {
  points: SparklinePoint[];
  width?: number;
  height?: number;
  /** When set, force the y-axis to this domain (e.g. [-1, 1] for temperature
   *  sparklines so flat-near-zero lines don't look dramatic). */
  yDomain?: [number, number];
  /** Highlight a specific bucket key with a darker dot. */
  highlightDate?: string;
  className?: string;
  ariaLabel?: string;
};

export function Sparkline({
  points,
  width = 160,
  height = 40,
  yDomain,
  highlightDate,
  className,
  ariaLabel,
}: Props) {
  const data = useMemo(
    () => points.map((p) => ({ date: p.date, value: p.value })),
    [points],
  );

  const hasAnyValue = data.some((d) => d.value !== null);

  if (!hasAnyValue) {
    return (
      <div
        style={{ width, height }}
        className={className}
        aria-label={ariaLabel}
        role="img"
      />
    );
  }

  const highlightPoint =
    highlightDate != null
      ? data.find((d) => d.date === highlightDate)
      : undefined;

  return (
    <div
      style={{ width, height }}
      className={className}
      aria-label={ariaLabel}
      role="img"
    >
      <LineChart
        data={data}
        width={width}
        height={height}
        margin={{ top: 4, right: 4, bottom: 4, left: 4 }}
      >
        {yDomain ? <YAxis hide domain={yDomain} /> : <YAxis hide />}
        <Line
          dataKey="value"
          type="monotone"
          stroke="currentColor"
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
          connectNulls
        />
        {highlightPoint && highlightPoint.value !== null ? (
          <ReferenceDot
            x={highlightPoint.date}
            y={highlightPoint.value}
            r={3}
            fill="currentColor"
            stroke="none"
            ifOverflow="visible"
          />
        ) : null}
      </LineChart>
    </div>
  );
}
