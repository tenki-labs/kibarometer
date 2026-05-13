// app/(site)/om/page.tsx — about page. Title + body sourced from the
// public.site_content table (slug = 'om') so an admin can edit copy on
// /admin/content/om without redeploying. Rendered dynamically per request
// so admin edits are visible immediately and never reset across deploys.

import Link from "next/link";
import { notFound } from "next/navigation";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { sb } from "@/lib/supabase";
import { renderMarkdown } from "@/lib/admin/markdown";

type SiteContent = {
  slug: string;
  title: string;
  body_md: string;
};

export const metadata = {
  title: "Om — Kibarometeret",
  description:
    "Kibarometeret er et uavhengig dashbord fra Tenki Labs som sporer AI-relaterte stillinger i norsk arbeidsmarked.",
};

export const dynamic = "force-dynamic";

export default async function OmPage() {
  const rows = await sb<SiteContent[]>(
    "/site_content?slug=eq.om&select=slug,title,body_md",
  );
  const row = rows[0];
  if (!row) notFound();
  const { title, body_md: body } = row;

  return (
    <main className="metode">
      <Breadcrumb className="mb-6">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/">Hjem</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Om</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <h1 className="title">{title}</h1>
      {renderMarkdown(body)}
    </main>
  );
}
