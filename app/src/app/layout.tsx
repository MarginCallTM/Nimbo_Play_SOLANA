import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

// Fonts are loaded once here via next/font (self-hosted at build time — no
// runtime request to Google, no flash of unstyled text) and exposed as a CSS
// variable that globals.css maps onto --font-sans / --font-display.
//
// F3.6 — ONE typeface for the whole site, the way the reference does it.
// The reference's own face is almost certainly PP Neue Montreal (commercial,
// not on Google Fonts). Geist is the closest thing that is free: Vercel drew it
// in the same Swiss geometric-grotesque lineage, and it carries the four traits
// that identify the reference — a straight bevelled `y` descender with no tail,
// a single-storey `g`, near-circular bowls, and horizontally cut terminals on
// `C`/`e`/`s`. Inter and Plus Jakarta Sans both miss on the `y` and the `g`.
//
// Variable font (100-900), so every weight ships in a single file.
const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

// This is the title/description a shared link shows. It states devnet on
// purpose: the arena settles real transactions, but on devnet SOL, and the
// site must never read as a mainnet product (CLAUDE.md — nothing misleading).
export const metadata: Metadata = {
  title: "Nimbo Play — Skill-Based Play-to-Earn on Solana",
  description:
    "Stake, play a real-time arena, and get paid on-chain in seconds. Gameplay runs off-chain; every stake and payout is settled by a Solana program. Live on devnet.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // F3.4 — `dark` lives on <html>, not on a wrapper inside the page. The
    // token values then reach <body> too, so the document itself is dark. With
    // the class further down, body kept the LIGHT --background: invisible while
    // a full-width child covered it, but the moment anything overflowed
    // horizontally a white band appeared beside the page.
    <html lang="en" className={`dark ${geist.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
