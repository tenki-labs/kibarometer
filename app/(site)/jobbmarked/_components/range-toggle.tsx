"use client";

import { cn } from "@/lib/utils";

export type Range = "1m" | "1q" | "1y" | "max";

const OPTIONS: { value: Range; label: string }[] = [
  { value: "1m", label: "1 mnd" },
  { value: "1q", label: "1 kv" },
  { value: "1y", label: "1 år" },
  { value: "max", label: "Maks" },
];

export function RangeToggle({
  value,
  onChange,
}: {
  value: Range;
  onChange: (next: Range) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Tidsintervall"
      className="inline-flex items-center gap-1 rounded-md border bg-card p-1 text-xs"
    >
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          role="tab"
          aria-selected={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded-sm px-2 py-1 font-mono uppercase tracking-[0.14em] transition-colors",
            value === opt.value
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
