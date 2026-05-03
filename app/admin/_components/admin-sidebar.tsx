"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

import { ADMIN_NAV, ADMIN_NAV_HREFS } from "./admin-nav";

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  const matches = pathname === href || pathname.startsWith(`${href}/`);
  if (!matches) return false;
  // Parent suppression: if a more specific registered href also matches,
  // let that one win so we don't highlight both rows on nested routes.
  return !ADMIN_NAV_HREFS.some(
    (other) =>
      other !== href &&
      other.startsWith(`${href}/`) &&
      (pathname === other || pathname.startsWith(`${other}/`)),
  );
}

function initials(value: string): string {
  if (!value) return "·";
  const parts = value.split(/[\s@]+/).filter(Boolean);
  return ((parts[0] ?? "")[0] ?? "")
    .concat((parts[1] ?? "")[0] ?? "")
    .toUpperCase() || "·";
}

type Props = { name: string; email: string; role: string };

export function AdminSidebar({ name, email, role }: Props) {
  const pathname = usePathname();
  const display = name || email;

  return (
    <Sidebar collapsible="icon" className="border-r">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              size="lg"
              tooltip="kibarometer admin"
              className="data-[active=true]:bg-transparent"
            >
              <Link href="/admin" aria-label="kibarometer admin">
                <div className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  <Activity className="size-4" />
                </div>
                <div className="flex flex-col leading-tight">
                  <span className="text-sm font-medium tracking-tight">
                    kibarometer
                  </span>
                  <span className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-muted-foreground">
                    admin
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {ADMIN_NAV.map((section) => (
          <SidebarGroup key={section.label}>
            <SidebarGroupLabel className="font-mono text-[0.6rem] uppercase tracking-[0.2em]">
              {section.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => {
                  const active = isActive(pathname, item.href);
                  const Icon = item.icon;
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={item.label}
                      >
                        <Link href={item.href}>
                          <Icon />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <div className="flex items-center gap-2 rounded-md p-1 group-data-[collapsible=icon]:p-0">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarFallback className="text-xs font-medium">
              {initials(display)}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-1 flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-medium">{display}</span>
            <span className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-muted-foreground">
              {role}
            </span>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
