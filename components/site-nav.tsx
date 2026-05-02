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

function NavList({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <ul className="flex flex-col gap-1">
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              onClick={onNavigate}
              className={cn(
                "block rounded-md px-3 py-2 text-sm font-mono uppercase tracking-wider transition-colors",
                active
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
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
    <>
      {/* Desktop: vertical sticky rail, vertically centered */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 z-30 w-56 flex-col justify-between border-r border-border bg-background px-6 py-8">
        <Link
          href="/"
          className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground hover:text-foreground"
        >
          kibarometer
        </Link>
        <nav aria-label="Hovednavigasjon">
          <NavList pathname={pathname} />
        </nav>
        <a
          href="/api/v1/headline"
          className="font-mono text-[0.65rem] uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          API
        </a>
      </aside>

      {/* Mobile: top bar with hamburger */}
      <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background px-4 py-3">
        <Link
          href="/"
          className="font-mono text-xs uppercase tracking-[0.22em] text-foreground"
        >
          kibarometer
        </Link>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Åpne meny">
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
                  <NavList
                    pathname={pathname}
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
      </header>
    </>
  );
}
