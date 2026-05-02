// app/embed/layout.tsx — minimal layout for /embed/* pages.
// No top nav, no footer, transparent background, sized for iframes.
// A small "kibarometer.no" wordmark stays visible so the data source is
// always traceable from inside an embed.

import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  // robots: noindex — these are meant to be iframed, not browsed directly.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#fafafa",
  colorScheme: "light",
};

export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <a
        href="https://kibarometer.no/"
        target="_blank"
        rel="noopener"
        className="embed-mark"
      >
        kibarometer.no
      </a>
    </>
  );
}
