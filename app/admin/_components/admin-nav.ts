import type { ComponentType } from "react";
import {
  BarChart3,
  Bot,
  Briefcase,
  Building2,
  Database,
  FileText,
  FolderTree,
  Gauge,
  LayoutDashboard,
  ListChecks,
  ListTodo,
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

// URL slug convention: English dev language so URLs match cron job
// names, table prefixes, and route handler paths. Sidebar labels stay
// Norwegian. PR 1 of admin restructure renames the top-level URLs and
// regroups into six categories; per-domain sub-routes (Stillinger /
// Selskaper entity browsers, /queue, /prompts) land in later PRs as
// those pages get built.
export const ADMIN_NAV: AdminNavSection[] = [
  {
    label: "Drift",
    items: [
      { href: "/admin", label: "Oversikt", icon: LayoutDashboard },
      { href: "/admin/processes", label: "Prosesser", icon: ListTodo },
      { href: "/admin/llm", label: "LLM-helse", icon: Bot },
      { href: "/admin/diagnostics", label: "Diagnostikk", icon: Gauge },
    ],
  },
  {
    label: "Jobbmarked",
    items: [
      { href: "/admin/job-market", label: "Oversikt", icon: LayoutDashboard },
      {
        href: "/admin/job-market/postings",
        label: "Stillinger",
        icon: Briefcase,
      },
      { href: "/admin/job-market/queue", label: "Kø", icon: ListChecks },
      { href: "/admin/job-market/categories", label: "Kategorier", icon: FolderTree },
      {
        href: "/admin/job-market/prompts",
        label: "Systemprompt",
        icon: MessageSquareCode,
      },
    ],
  },
  {
    label: "Medie-dekning",
    items: [
      { href: "/admin/media", label: "Oversikt", icon: Newspaper },
      {
        href: "/admin/media/prompts",
        label: "Systemprompt",
        icon: MessageSquareCode,
      },
    ],
  },
  {
    label: "Oppstart",
    items: [
      { href: "/admin/startups", label: "Oversikt", icon: Building2 },
    ],
  },
  {
    label: "Data",
    items: [
      { href: "/admin/keywords", label: "Nøkkelord", icon: Tag },
      {
        href: "/admin/keywords/candidates",
        label: "Kandidater",
        icon: Sparkles,
      },
      { href: "/admin/database", label: "Database", icon: Database },
    ],
  },
  {
    label: "Nettside",
    items: [
      { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
      { href: "/admin/content", label: "Innhold", icon: FileText },
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
  // Domain-hub and entity segments not in ADMIN_NAV (yet) but reachable
  // via existing pages or redirects — seed breadcrumb labels by hand so
  // /admin/job-market/categories renders as "Jobbmarked / Kategorier" etc.
  out["job-market"] = "Jobbmarked";
  out.startups = "Oppstart";
  out.media = "Medie-dekning";
  out.prompts = "Systemprompt";
  out.processes = "Prosesser";
  out.candidates = "Kandidater";
  out.companies = "Selskaper";
  out.queue = "Kø";
  return out;
})();
