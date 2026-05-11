"use client";

import * as React from "react";
import Link from "next/link";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu";
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
];

export function SiteNav() {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [desktopValue, setDesktopValue] = React.useState("");

  // Close menus when crossing the sm breakpoint. Without this, an open Portal
  // anchored to a now-`display: none` trigger snaps to (0, 0) — Radix reads
  // a zeroed getBoundingClientRect from the hidden trigger.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(min-width: 640px)");
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches) setMobileOpen(false);
      else setDesktopValue("");
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return (
    <header className="sticky top-0 z-30 bg-background">
      <div className="flex h-14 w-full items-center justify-between px-4 sm:px-6">
        {/* Left: brand mark + Tenki Labs attribution */}
        <div className="flex items-center gap-3">
          <NavigationMenu className="flex-none" viewport={false}>
            <NavigationMenuList>
              <NavigationMenuItem>
                <NavigationMenuLink
                  asChild
                  className={cn(
                    "font-mono text-sm font-medium uppercase tracking-[0.18em] hover:bg-transparent focus:bg-transparent data-[active=true]:bg-transparent",
                  )}
                >
                  <Link href="/">KI BAROMETERET</Link>
                </NavigationMenuLink>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>
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
        <NavigationMenu
          className="hidden sm:flex"
          viewport={false}
          delayDuration={150}
          skipDelayDuration={0}
          value={desktopValue}
          onValueChange={setDesktopValue}
        >
          <NavigationMenuList>
            <NavigationMenuItem value="kibarometre">
              <NavigationMenuTrigger
                className="font-mono text-xs uppercase tracking-[0.14em]"
                onClick={(e) => {
                  if (desktopValue === "kibarometre") e.preventDefault();
                }}
              >
                Kibarometre
              </NavigationMenuTrigger>
              <NavigationMenuContent className="left-auto right-0 w-auto">
                <ul className="grid w-[20rem] gap-1 p-2">
                  {KIBAROMETRE.map((item) => (
                    <li key={item.href}>
                      <NavigationMenuLink asChild>
                        <Link href={item.href} className="block">
                          <span className="text-sm font-medium leading-none">
                            {item.title}
                          </span>
                          <span className="mt-1 text-xs text-muted-foreground">
                            {item.description}
                          </span>
                        </Link>
                      </NavigationMenuLink>
                    </li>
                  ))}
                </ul>
              </NavigationMenuContent>
            </NavigationMenuItem>

            <NavigationMenuItem>
              <NavigationMenuLink
                asChild
                className={cn(
                  navigationMenuTriggerStyle(),
                  "font-mono text-xs uppercase tracking-[0.14em]",
                )}
              >
                <Link href="/docs">Docs</Link>
              </NavigationMenuLink>
            </NavigationMenuItem>

            <NavigationMenuItem>
              <NavigationMenuLink
                asChild
                className={cn(
                  navigationMenuTriggerStyle(),
                  "font-mono text-xs uppercase tracking-[0.14em]",
                )}
              >
                <Link href="/om">Om</Link>
              </NavigationMenuLink>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>

        <ThemeToggle />

        {/* Right: mobile burger (DropdownMenu) */}
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
