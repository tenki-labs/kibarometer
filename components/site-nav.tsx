"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetTrigger } from "@/components/ui/sheet";

type NavItem = { href: string; label: string };

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Jobb-barometer" },
  { href: "/media", label: "Media-barometer" },
  { href: "/metode", label: "Metode" },
  { href: "/om", label: "Om" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({
  pathname,
  orientation,
  onNavigate,
}: {
  pathname: string;
  orientation: "horizontal" | "vertical";
  onNavigate?: () => void;
}) {
  return (
    <ul
      className={cn(
        "flex gap-1",
        orientation === "vertical" ? "flex-col" : "flex-row items-center",
      )}
    >
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              onClick={onNavigate}
              className={cn(
                "block rounded-md px-3 py-2 text-xs font-mono uppercase tracking-wider transition-colors",
                active
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function SiteNav() {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-14 w-full max-w-[1100px] items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          className="font-mono text-xs uppercase tracking-[0.22em] text-foreground hover:text-muted-foreground"
        >
          kibarometer
        </Link>

        {/* Desktop: inline links + API */}
        <nav
          aria-label="Hovednavigasjon"
          className="hidden md:flex items-center gap-4"
        >
          <NavLinks pathname={pathname} orientation="horizontal" />
          <a
            href="/api/v1/headline"
            className="font-mono text-[0.65rem] uppercase tracking-widest text-muted-foreground hover:text-foreground"
          >
            API
          </a>
        </nav>

        {/* Mobile: hamburger drawer (Norwegian labels are too wide for a phone) */}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Åpne meny"
              className="md:hidden"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-72">
            <div className="mt-8">
              <p className="mb-6 font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">
                kibarometer
              </p>
              <SheetClose asChild>
                <div>
                  <NavLinks
                    pathname={pathname}
                    orientation="vertical"
                    onNavigate={() => setOpen(false)}
                  />
                </div>
              </SheetClose>
              <div className="mt-8 border-t border-border pt-4">
                <a
                  href="/api/v1/headline"
                  onClick={() => setOpen(false)}
                  className="font-mono text-[0.65rem] uppercase tracking-widest text-muted-foreground hover:text-foreground"
                >
                  API
                </a>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}