import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Fraunces, Hanken_Grotesk } from "next/font/google";
import { Providers } from "./providers";
import Backdrop from "@/components/Backdrop";
import "./globals.css";

// Fonts via next/font — self-hosted, no layout shift, no external Google CSS.
// Fraunces: variable display serif; pulls the SOFT + opsz axes. Exposed as
// --font-fraunces.
const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  // Variable font: the full weight range (300..700) ships automatically; named
  // axes can only be requested when weight is left variable.
  axes: ["SOFT", "opsz"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
});

// Hanken Grotesk OPERATES and READS: the operational workhorse and the
// long-form reading font (decided: no reading serif). Exposed as --font-hanken
// and set as MUI's default typography.fontFamily.
const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
  variable: "--font-hanken",
});

// Architects Daughter is intentionally not loaded here: docs/slides-only
// annotation font, must never ship in the app bundle. --font-annotate exists
// for documentation but is referenced nowhere in product code.

export const metadata: Metadata = {
  title: "KnowledgeCore",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${hanken.variable}`}>
      <body>
        {/* Global texture + shared hand-mark defs, behind all content. */}
        <Backdrop />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
