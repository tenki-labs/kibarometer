import { SiteNav } from "@/components/site-nav";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <SiteNav />
      <div className="lg:pl-56">{children}</div>
    </div>
  );
}
