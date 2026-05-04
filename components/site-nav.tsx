"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type NavItem = {
  href: string;
  label: string;
  description: string;
};

const NAV_ITEMS: NavItem[] = [
  {
    href: "/jobbmarked",
    label: "Jobbmarked",
    description: "Daglig oppdaterte tall fra NAV",
  },
  {
    href: "/media",
    label: "Media-barometer",
    description: "Hvordan mediene dekker AI",
  },
  {
    href: "/metode",
    label: "Metode",
    description: "Hvordan vi måler",
  },
  {
    href: "/om",
    label: "Om",
    description: "Bak prosjektet",
  },
];

export function SiteNav() {
  return (
    <header className="sticky top-0 z-30 bg-background">
      <div className="mx-auto flex h-14 w-full max-w-[1100px] items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          className="text-sm tracking-tight text-foreground hover:text-muted-foreground"
        >
          kibarometer
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="cursor-pointer font-mono text-xs uppercase tracking-[0.18em]"
            >
              Menu
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={12}
            className="w-[min(24rem,calc(100vw-2rem))] p-2"
          >
            {NAV_ITEMS.map((item) => (
              <DropdownMenuItem
                key={item.href}
                asChild
                className="cursor-pointer rounded-md px-3 py-3 focus:bg-accent data-[highlighted]:bg-accent"
              >
                <Link
                  href={item.href}
                  className="flex flex-col items-start gap-1"
                >
                  <span className="text-xl font-medium tracking-tight text-foreground">
                    {item.label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {item.description}
                  </span>
                </Link>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator className="my-2" />
            <DropdownMenuItem
              asChild
              className="cursor-pointer rounded-md px-3 py-2 focus:bg-accent data-[highlighted]:bg-accent"
            >
              <a
                href="/api/v1/headline"
                className="flex items-center justify-between font-mono text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground"
              >
                <span>API</span>
                <span aria-hidden="true">→</span>
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
