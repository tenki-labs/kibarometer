"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

export type ChartHoverRow = {
  key: string;
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  color?: string;
  subClassName?: string;
};

type RechartsPayloadItem = {
  name?: string | number;
  dataKey?: string | number;
  value?: number | string;
  color?: string;
  payload?: unknown;
};

export type ChartHoverPanelProps = {
  mode: "single" | "stacked";
  activeKey?: string;
  rows: (
    payload: RechartsPayloadItem[],
    label: unknown,
  ) => ChartHoverRow[];
  header?: (label: unknown, payload: RechartsPayloadItem[]) => React.ReactNode;
  active?: boolean;
  payload?: RechartsPayloadItem[];
  label?: unknown;
  className?: string;
};

export function ChartHoverPanel({
  mode,
  activeKey,
  rows: getRows,
  header,
  active,
  payload,
  label,
  className,
}: ChartHoverPanelProps) {
  if (!active || !payload?.length) return null;

  const allRows = getRows(payload, label);
  const visible =
    mode === "stacked"
      ? activeKey
        ? allRows.filter((r) => r.key === activeKey)
        : []
      : allRows;

  if (visible.length === 0) return null;

  return (
    <div
      className={cn(
        "max-w-xs rounded-md border bg-popover p-2 text-popover-foreground shadow-md",
        className,
      )}
    >
      {header ? (
        <div className="text-xs font-medium text-foreground">
          {header(label, payload)}
        </div>
      ) : null}
      <div className={cn("flex flex-col gap-1.5", header && "mt-1.5")}>
        {visible.map((r) => (
          <div key={r.key} className="flex flex-col gap-0.5">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                {r.color ? (
                  <span
                    className="h-2 w-2 shrink-0 rounded-[2px]"
                    style={{ backgroundColor: r.color }}
                    aria-hidden
                  />
                ) : null}
                {r.label}
              </span>
              <span className="font-medium tabular-nums text-foreground">
                {r.value}
              </span>
            </div>
            {r.sub ? (
              <span
                className={cn(
                  "text-[0.7rem] leading-snug text-muted-foreground",
                  r.subClassName,
                )}
              >
                {r.sub}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}