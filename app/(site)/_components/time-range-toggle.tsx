"use client";

import { useMemo } from "react";
import { ChevronDownIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Standard time-range vocabulary, used by every public scroller.
export type Range = "1m" | "6m" | "1y" | "since-2024" | "max";

export const STANDARD_RANGE_OPTIONS: { value: Range; label: string }[] = [
  { value: "1m",         label: "1 mnd" },
  { value: "6m",         label: "6 mnd" },
  { value: "1y",         label: "1 år" },
  { value: "since-2024", label: "Siden 2024" },
  { value: "max",        label: "Maks" },
];

export type TimeRangeOption<T extends string> = { value: T; label: string };

export function TimeRangeToggle<T extends string = Range>({
  value,
  onChange,
  options,
  disabledValues,
}: {
  value: T;
  onChange: (next: T) => void;
  options?: TimeRangeOption<T>[];
  // Range values to render as disabled (with "Ikke nok data ennå" tooltip).
  // Each scroller computes this from its own data-derived nowMs + horizon
  // and passes the result — keeps Date.now() out of render to avoid
  // SSR/client hydration mismatch on boundary cases.
  disabledValues?: ReadonlyArray<T>;
}) {
  const opts =
    options ?? (STANDARD_RANGE_OPTIONS as unknown as TimeRangeOption<T>[]);
  const disabledSet = useMemo(
    () => new Set(disabledValues ?? []),
    [disabledValues],
  );
  const activeLabel = opts.find((o) => o.value === value)?.label ?? opts[0]?.label ?? "";

  return (
    // TooltipProvider is mounted here because no provider sits in the
    // (site) layout — disabled items rely on it for the explanation hover.
    <TooltipProvider delayDuration={150}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="default"
            size="sm"
            aria-label="Tidsintervall"
            className="group gap-1.5 font-mono text-xs uppercase tracking-[0.14em]"
          >
            {activeLabel}
            <ChevronDownIcon
              className="size-3 transition duration-300 group-data-[state=open]:rotate-180"
              aria-hidden="true"
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={6} className="min-w-[10rem]">
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(v) => onChange(v as T)}
          >
            {opts.map((opt) => {
              const disabled = disabledSet.has(opt.value);
              if (!disabled) {
                return (
                  <DropdownMenuRadioItem
                    key={opt.value}
                    value={opt.value}
                    className="font-mono text-xs uppercase tracking-[0.14em]"
                  >
                    {opt.label}
                  </DropdownMenuRadioItem>
                );
              }
              // Radix sets `pointer-events-none` on disabled items
              // (dropdown-menu.tsx:127) which kills tooltip hover. Wrap
              // in a tabbable span so the span receives pointer/focus
              // events while the inner item keeps its disabled styling.
              return (
                <Tooltip key={opt.value}>
                  <TooltipTrigger asChild>
                    <span tabIndex={0} className="block outline-none">
                      <DropdownMenuRadioItem
                        value={opt.value}
                        disabled
                        className="font-mono text-xs uppercase tracking-[0.14em]"
                      >
                        {opt.label}
                      </DropdownMenuRadioItem>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    Ikke nok data ennå
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </TooltipProvider>
  );
}
