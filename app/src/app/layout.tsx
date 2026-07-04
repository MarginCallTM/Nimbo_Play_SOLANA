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

export const metadata: Metadata = {
  title: "Nimbo Play — The On-Chain Lottery on Solana",
  description:
    "Provably fair lottery on Solana. Buy a ticket, win the vault. Transparent, secure, instant payouts.",
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
