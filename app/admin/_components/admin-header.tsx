"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Search } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { logoutAction } from "@/app/admin/login/actions";
import { ADMIN_SEGMENT_LABELS } from "./admin-nav";
import { SearchCommand, useSearchHotkey } from "./search-command";

function buildCrumbs(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  const crumbs: { href: string; label: string; isLast: boolean }[] = [];
  let acc = "";
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    acc += `/${seg}`;
    const label = ADMIN_SEGMENT_LABELS[seg] ?? prettifyId(seg);
    crumbs.push({ href: acc, label, isLast: i === segments.length - 1 });
  }
  // Always at least one crumb (Oversikt) when on /admin exactly.
  if (crumbs.length === 1 && crumbs[0].href === "/admin") {
    crumbs.push({ href: "/admin", label: "Oversikt", isLast: true });
    crumbs[0].isLast = false;
  }
  return crumbs;
}

function prettifyId(seg: string): string {
  // UUIDs and other ids — show the short prefix.
  if (/^[0-9a-f-]{36}$/.test(seg)) return seg.slice(0, 8) + "…";
  return seg;
}

function initials(name: string): string {
  if (!name) return "·";
  const parts = name.split(/[\s@]+/).filter(Boolean);
  return ((parts[0] ?? "")[0] ?? "").concat((parts[1] ?? "")[0] ?? "").toUpperCase() || "·";
}

type Props = { name: string; email: string; role: string };

export function AdminHeader({ name, email, role }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  useSearchHotkey(setOpen);
  const crumbs = buildCrumbs(pathname);
  const display = name || email;

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mx-1 h-5" />

      <Breadcrumb>
        <BreadcrumbList className="font-mono text-xs uppercase tracking-[0.18em]">
          {crumbs.map((c, i) => (
            <React.Fragment key={c.href + i}>
              <BreadcrumbItem>
                {c.isLast ? (
                  <BreadcrumbPage>{c.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={c.href}>{c.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!c.isLast ? <BreadcrumbSeparator /> : null}
            </React.Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-keyshortcuts="Meta+K Control+K"
          className="hidden h-9 w-80 items-center gap-2 rounded-md border border-transparent bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted/70 md:inline-flex lg:w-96"
        >
          <Search className="h-4 w-4" />
          <span className="flex-1 text-left">Søk…</span>
          <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
            <span className="text-xs">⌘</span>K
          </kbd>
        </button>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Søk"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-input bg-background text-muted-foreground shadow-sm transition-colors hover:bg-accent md:hidden"
        >
          <Search className="h-4 w-4" />
        </button>

        <UserMenu display={display} role={role} />
      </div>

      <SearchCommand open={open} onOpenChange={setOpen} />
    </header>
  );
}

// Logout via onSelect + useTransition. Avoids the brittle pattern of a
// <form> inside DropdownMenuContent (which Radix portals out of the DOM
// tree it was rendered in — submission can race the menu closing).
function UserMenu({ display, role }: { display: string; role: string }) {
  const [pending, startTransition] = React.useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Brukermeny"
          className="rounded-full ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-xs font-medium">
              {initials(display)}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">{display}</span>
          <span className="font-mono text-[0.65rem] uppercase tracking-wider text-muted-foreground">
            {role}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={pending}
          onSelect={() => startTransition(() => logoutAction())}
        >
          <LogOut />
          <span>{pending ? "Logger ut…" : "Logg ut"}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
