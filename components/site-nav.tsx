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

type NavItem = { href: string; label: string };

const NAV_ITEMS: NavItem[] = [
  { href: "/jobb-barometer", label: "Jobb-barometer" },
  { href: "/media", label: "Media-barometer" },
  { href: "/metode", label: "Metode" },
  { href: "/om", label: "Om" },
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
              className="font-mono text-xs uppercase tracking-[0.18em]"
            >
              Menu
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={8} className="w-48">
            {NAV_ITEMS.map((item) => (
              <DropdownMenuItem key={item.href} asChild>
                <Link href={item.href}>{item.label}</Link>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href="/api/v1/headline">API</a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
