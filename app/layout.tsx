import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";

import { ThemeProvider } from "@/components/theme-provider";

import "./globals.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

const TITLE = "Kibarometeret";
const DESCRIPTION =
  "Uavhengig dashbord som sporer AI-relaterte stillinger i norsk arbeidsmarked. Daglig oppdaterte tall fra NAVs stillingsfeed, åpen metode.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: "%s | Kibarometeret" },
  description: DESCRIPTION,
  applicationName: "Kibarometeret",
  authors: [{ name: "Oscar Gangstad Westbye", url: "https://tenki.no" }],
  creator: "Tenki Labs",
  publisher: "Tenki Labs",
  category: "data journalism",
  keywords: [
    "arbeidsmarked",
    "AI",
    "kunstig intelligens",
    "NAV",
    "stillinger",
    "Norge",
    "datajournalistikk",
    "labour market",
    "Norway",
    "AI hiring",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "nb_NO",
    url: "/",
    siteName: "Kibarometeret",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/opengraph-image"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  colorScheme: "light dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="nb"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="font-sans antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
