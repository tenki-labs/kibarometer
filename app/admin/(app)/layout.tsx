import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AdminHeader } from "@/app/admin/_components/admin-header";
import { AdminSidebar } from "@/app/admin/_components/admin-sidebar";
import { getStaffClaims } from "@/lib/admin/auth";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · kibarometer admin" },
  robots: { index: false, follow: false },
};

export default async function AdminAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const claims = await getStaffClaims();
  if (!claims) redirect("/admin/login");

  const email = claims.email ?? "";
  const name = claims.user_metadata?.full_name ?? email;
  const role = claims.user_metadata?.role ?? "ukjent";

  return (
    <SidebarProvider>
      <AdminSidebar name={name} email={email} role={role} />
      <SidebarInset className="flex min-h-svh flex-col">
        <AdminHeader name={name} email={email} role={role} />
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
