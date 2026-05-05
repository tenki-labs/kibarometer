import type { ComponentType } from "react";
import {
  BarChart3,
  Bot,
  Database,
  FileText,
  FolderTree,
  Gauge,
  Hammer,
  LayoutDashboard,
  MessageSquareCode,
  Newspaper,
  Sparkles,
  Tag,
} from "lucide-react";

export type AdminNavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

export type AdminNavSection = {
  label: string;
  items: AdminNavItem[];
};

export const ADMIN_NAV: AdminNavSection[] = [
  {
    label: "Drift",
    items: [
      { href: "/admin", label: "Oversikt", icon: LayoutDashboard },
      { href: "/admin/jobs", label: "Jobber", icon: Hammer },
      { href: "/admin/llm", label: "AI-analyse", icon: Bot },
    ],
  },
  {
    label: "Taksonomi",
    items: [
      { href: "/admin/keywords", label: "Nøkkelord", icon: Tag },
      {
        href: "/admin/keywords/candidates",
        label: "Kandidater",
        icon: Sparkles,
      },
      { href: "/admin/categories", label: "Kategorier", icon: FolderTree },
      {
        href: "/admin/llm-prompts",
        label: "Systemprompt",
        icon: MessageSquareCode,
      },
    ],
  },
  {
    label: "Innsikt",
    items: [
      { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
      { href: "/admin/media", label: "Mediedekning", icon: Newspaper },
      { href: "/admin/diagnostics", label: "Diagnostikk", icon: Gauge },
      { href: "/admin/content", label: "Innhold", icon: FileText },
      { href: "/admin/database", label: "Data", icon: Database },
    ],
  },
];

export const ADMIN_NAV_HREFS: string[] = ADMIN_NAV.flatMap((s) =>
  s.items.map((i) => i.href),
);

export const ADMIN_SEGMENT_LABELS: Record<string, string> = (() => {
  const out: Record<string, string> = { admin: "Admin" };
  for (const section of ADMIN_NAV) {
    for (const item of section.items) {
      const seg = item.href.split("/").filter(Boolean).pop();
      if (seg) out[seg] = item.label;
    }
  }
  return out;
})();
