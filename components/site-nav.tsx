"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDownIcon } from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type Kibarometer = {
  href: string;
  title: string;
  description: string;
};

const KIBAROMETRE: Kibarometer[] = [
  {
    href: "/arbeidsmarked",
    title: "Arbeidsmarked",
    description: "AI-stillinger fra NAVs feed",
  },
  {
    href: "/oppstart",
    title: "Oppstart",
    description: "Nye foretak fra Brønnøysundregistrene",
  },
  {
    href: "/media",
    title: "Media",
    description: "Kibarometer-indeks for medieklimaet",
  },
  {
    href: "/offentlig",
    title: "Offentlig sektor",
    description: "AI-debatt på Stortinget (+ Doffin kommer)",
  },
];

// Shared styling for the top-level nav items (matches the previous
// navigationMenuTriggerStyle so the visual stays unchanged after the
// switch to DropdownMenu — see notes on the SiteNav export below).
const NAV_ITEM_CLASS =
  "inline-flex h-9 items-center justify-center rounded-md bg-background px-4 py-2 font-mono text-xs font-medium uppercase tracking-[0.14em] transition-[color,box-shadow] outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 data-[state=open]:bg-accent/50 data-[state=open]:text-accent-foreground";

// The desktop "Kibarometre" trigger previously lived inside a Radix
// NavigationMenu with delayDuration + controlled state + a manual onClick
// preventDefault workaround. That stack mixed hover-to-open and
// click-to-toggle and produced a first-click-unresponsive bug on
// mouse/trackpad. Switching to DropdownMenu (click-only, same pattern as
// the mobile burger) removes the hover/click race entirely.
export function SiteNav() {
  const [mobileOpen, setMobileOpen] = React.useState(false);

  // Close the mobile dropdown when crossing the sm breakpoint. Without
  // this, an open Portal anchored to a now-`display: none` trigger snaps
  // to (0, 0) — Radix reads a zeroed getBoundingClientRect from the
  // hidden trigger.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(min-width: 640px)");
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches) setMobileOpen(false);
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return (
    <header className="sticky top-0 z-30 bg-background">
      <div className="flex h-14 w-full items-center justify-between px-4 sm:px-6">
        {/* Left: brand mark + Tenki Labs attribution */}
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex h-9 items-center rounded-md px-4 py-2 font-mono text-sm font-medium uppercase tracking-[0.18em] transition-[color] outline-none hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1"
          >
            KI BAROMETERET
          </Link>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            drevet av{" "}
            <a
              href="https://tenki.no"
              target="_blank"
              rel="noopener"
              className="hover:text-foreground hover:underline"
            >
              Tenki Labs
            </a>
          </span>
        </div>

        {/* Right cluster: desktop nav + theme toggle + mobile burger */}
        <div className="flex items-center gap-1">
          <nav className="hidden items-center sm:flex">
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(NAV_ITEM_CLASS, "group")}
                aria-label="Kibarometre"
              >
                Kibarometre
                <ChevronDownIcon
                  className="relative top-[1px] ml-1 size-3 transition duration-300 group-data-[state=open]:rotate-180"
                  aria-hidden="true"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                sideOffset={8}
                className="w-[20rem] p-2"
              >
                {KIBAROMETRE.map((item) => (
                  <DropdownMenuItem
                    key={item.href}
                    asChild
                    className="cursor-pointer rounded-md focus:bg-accent data-[highlighted]:bg-accent"
                  >
                    <Link
                      href={item.href}
                      className="flex flex-col items-start gap-1 px-3 py-2"
                    >
                      <span className="text-sm font-medium leading-none">
                        {item.title}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Link href="/docs" className={NAV_ITEM_CLASS}>
              Docs
            </Link>
            <Link href="/om" className={NAV_ITEM_CLASS}>
              Om
            </Link>
          </nav>

          <ThemeToggle />

          {/* Mobile burger (DropdownMenu) */}
          <DropdownMenu open={mobileOpen} onOpenChange={setMobileOpen}>
            <DropdownMenuTrigger asChild className="sm:hidden">
              <Button
                variant="ghost"
                size="sm"
                className="font-mono text-xs uppercase tracking-[0.18em]"
              >
                Menu
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={12}
              className="w-[min(22rem,calc(100vw-2rem))] p-2"
            >
              {KIBAROMETRE.map((item) => (
                <DropdownMenuItem
                  key={item.href}
                  asChild
                  className="cursor-pointer rounded-md focus:bg-accent data-[highlighted]:bg-accent"
                >
                  <Link
                    href={item.href}
                    className="flex flex-col items-start gap-1 px-3 py-3"
                  >
                    <span className="text-sm font-medium leading-none">
                      {item.title}
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
                className="cursor-pointer rounded-md focus:bg-accent data-[highlighted]:bg-accent"
              >
                <Link
                  href="/docs"
                  className="flex flex-col items-start gap-1 px-3 py-3"
                >
                  <span className="text-sm font-medium leading-none">Docs</span>
                  <span className="text-xs text-muted-foreground">
                    Slik fungerer hver pipeline
                  </span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                asChild
                className="cursor-pointer rounded-md focus:bg-accent data-[highlighted]:bg-accent"
              >
                <Link
                  href="/om"
                  className="flex flex-col items-start gap-1 px-3 py-3"
                >
                  <span className="text-sm font-medium leading-none">Om</span>
                  <span className="text-xs text-muted-foreground">
                    Bak prosjektet
                  </span>
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
