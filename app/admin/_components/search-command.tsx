"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

import { ADMIN_NAV } from "./admin-nav";

type Props = { open: boolean; onOpenChange: (next: boolean) => void };

// CMD+K palette. Mirrors the sidebar so every staff destination is one
// keystroke away. The cmdk fuzzy matcher only inspects each item's `value`
// string (not the group heading), so we fold the section label into value
// to make queries like "drift" surface that whole group.
export function SearchCommand({ open, onOpenChange }: Props) {
  const router = useRouter();

  const go = React.useCallback(
    (href: string) => {
      onOpenChange(false);
      router.push(href);
    },
    [router, onOpenChange],
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Søk i admin…" />
      <CommandList>
        <CommandEmpty>Ingen treff.</CommandEmpty>
        {ADMIN_NAV.map((section) => (
          <CommandGroup key={section.label} heading={section.label}>
            {section.items.map((item) => {
              const Icon = item.icon;
              return (
                <CommandItem
                  key={item.href}
                  value={`${section.label} ${item.label} ${item.href}`}
                  onSelect={() => go(item.href)}
                >
                  <Icon />
                  <span>{item.label}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}

// Lightweight global ⌘K keyboard binding hook used by the header trigger.
export function useSearchHotkey(setOpen: (next: boolean) => void) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);
}
