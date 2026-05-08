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
    href: "/jobbmarked",
    title: "Jobbmarked",
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
    href: "/mediedekning",
    title: "Mediedekning",
    description: "Rå dekning fra norske medier",
  },
];

export function SiteNav() {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
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
                  <Link href="/">KIBAROMETER</Link>
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

        {/* Right: desktop NavigationMenu */}
        <NavigationMenu className="hidden sm:flex">
          <NavigationMenuList>
            <NavigationMenuItem>
              <NavigationMenuTrigger className="font-mono text-xs uppercase tracking-[0.14em]">
                Kibarometre
              </NavigationMenuTrigger>
              <NavigationMenuContent>
                <ul className="grid w-[20rem] gap-1 p-2 sm:w-[26rem] sm:grid-cols-2">
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

        {/* Right: mobile burger (DropdownMenu) */}
        <DropdownMenu>
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
    </header>
  );
}
