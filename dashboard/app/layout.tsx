import type { Metadata } from "next";
import Script from "next/script";
import { THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = { title: "Ladder", description: "Your investments and why you own them" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Script id="theme" strategy="beforeInteractive">{THEME_SCRIPT}</Script>
        {children}
      </body>
    </html>
  );
}
