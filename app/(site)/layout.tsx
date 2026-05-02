// app/(site)/layout.tsx — wraps the public-facing pages (dashboard, metode,
// om) with a thin top nav. Embed routes (app/embed/*) and JSON endpoints
// (app/api/*) live outside this group so they don't inherit the chrome.

import Link from "next/link";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="topnav">
        <div className="topnav-inner">
          <Link href="/" className="topnav-brand">
            kibarometer
          </Link>
          <nav className="topnav-links">
            <Link href="/">Dashbord</Link>
            <Link href="/metode">Metode</Link>
            <Link href="/om">Om</Link>
            <a href="/api/v1/headline">API</a>
          </nav>
        </div>
      </header>
      {children}
    </>
  );
}
