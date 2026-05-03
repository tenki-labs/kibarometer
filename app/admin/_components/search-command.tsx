"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Hammer, LayoutDashboard, Tag } from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

const ITEMS = [
  { href: "/admin", label: "Oversikt", icon: LayoutDashboard },
  { href: "/admin/jobs", label: "Jobber", icon: Hammer },
  { href: "/admin/keywords", label: "Nøkkelord", icon: Tag },
] as const;

type Props = { open: boolean; onOpenChange: (next: boolean) => void };

// CMD+K palette. Today only navigates between admin sections; once the admin
// has search-worthy content (job log, keyword fuzzy match, etc.) we extend
// the dialog with extra <CommandGroup>s.
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
        <CommandGroup heading="Naviger">
          {ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <CommandItem
                key={item.href}
                value={`${item.label} ${item.href}`}
                onSelect={() => go(item.href)}
              >
                <Icon />
                <span>{item.label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
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
