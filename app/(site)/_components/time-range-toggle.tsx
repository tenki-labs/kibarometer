"use client";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { cn } from "@/lib/utils";

// Legacy range vocabulary, still used by /media and /jobbmarked.
export type Range = "1m" | "1q" | "1y" | "max";

const LEGACY_OPTIONS: { value: Range; label: string }[] = [
  { value: "1m", label: "1 mnd" },
  { value: "1q", label: "1 kv" },
  { value: "1y", label: "1 år" },
  { value: "max", label: "Maks" },
];

export type TimeRangeOption<T extends string> = { value: T; label: string };

export function TimeRangeToggle<T extends string = Range>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (next: T) => void;
  options?: TimeRangeOption<T>[];
}) {
  const opts =
    options ?? (LEGACY_OPTIONS as unknown as TimeRangeOption<T>[]);
  return (
    <ButtonGroup aria-label="Tidsintervall">
      {opts.map((opt) => {
        const active = opt.value === value;
        return (
          <Button
            key={opt.value}
            type="button"
            variant={active ? "default" : "outline"}
            size="sm"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={cn(
              "font-mono text-xs uppercase tracking-[0.14em]",
              !active && "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.label}
          </Button>
        );
      })}
    </ButtonGroup>
  );
}
