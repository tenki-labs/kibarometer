import Script from "next/script";

import { SiteNav } from "@/components/site-nav";

// Umami tracker. Path /_umami/script.js is reverse-proxied to kiba-umami:3000
// by the edge Caddy. The website-id is bundled at build time from
// NEXT_PUBLIC_UMAMI_WEBSITE_ID (deploy.sh syncs it from admin.env). When the
// var is empty (e.g. before first-time Umami setup), no tag is emitted.
const UMAMI_WEBSITE_ID = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <SiteNav />
      {children}
    </div>
  );
}
