import type { Metadata } from "next";
import { Inter, Fredoka } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

// Fonts are loaded once here via next/font (self-hosted at build time — no
// runtime request to Google, no flash of unstyled text) and exposed as CSS
// variables. globals.css maps --font-sans/--font-display onto Inter and
// --font-brand onto Fredoka (brand name next to the logo only).
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const fredoka = Fredoka({
  variable: "--font-fredoka",
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
    <html lang="en" className={`${inter.variable} ${fredoka.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
