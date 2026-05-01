import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "kibarometer",
  description:
    "Kibarometeret — uavhengig analyse av norsk arbeidsmarked basert på data fra NAV.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nb">
      <body>{children}</body>
    </html>
  );
}
