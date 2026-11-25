import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Freyr — Trading Intelligence",
  description:
    "Gold-first trading intelligence: institutional order flow, liquidity structure, multi-engine analysis, signals, risk and an honest record of every call.",
};

export const viewport: Viewport = {
  themeColor: "#0b0b0c",
  colorScheme: "dark light",
  viewportFit: "cover",
  maximumScale: 1,
  userScalable: false,
};

const APPEARANCE_SCRIPT = `(function(){try{var m=localStorage.getItem('freyr-appearance')||'dark';var r=m==='system'?(window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):m;document.documentElement.setAttribute('data-theme',r);document.documentElement.style.colorScheme=r;}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-canvas font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
