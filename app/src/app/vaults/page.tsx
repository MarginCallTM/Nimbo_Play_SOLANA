// /vaults — vault selection + ticket purchase page.
// Ported from app-reference/src/routes/vaults.tsx, restyled corporate:
// no floating chests/clouds; ambient gradient-hero echoes the homepage.
// Server Component shell; interactivity lives in VaultPicker (selection,
// live mock stats) and FinishedRounds (tabs).
import type { Metadata } from "next";
import { Ticker } from "@/components/site/ticker";
import { Header } from "@/components/site/header";
import { Footer } from "@/components/site/footer";
import { VaultPicker } from "@/components/vaults/vault-picker";
import { MyTicketsDashboard } from "@/components/vaults/my-tickets-dashboard";
import { WinnerCta } from "@/components/vaults/winner-cta";
import { FinishedRounds } from "@/components/vaults/finished-rounds";

export const metadata: Metadata = {
  title: "Choose your vault — Nimbo Play",
  description:
    "Select a vault, pick your ticket amount and enter the round. Settled on Solana.",
};

export default function VaultsPage() {
  return (
    // `dark` scopes the dark token set (globals.css .dark) to this page only:
    // every bg-*/text-*/border-* utility below resolves to the navy palette,
    // header/footer included — deliberate contrast with the light homepage.
    <div className="dark relative min-h-screen overflow-hidden bg-background text-foreground">
      {/* Ambient background: dark variant of the hero gradient (soft blue
          glow at the top), fading into the page background. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[560px]"
        style={{ background: "var(--gradient-hero)" }}
      />

      <Ticker />
      <Header />

      <main className="relative mx-auto max-w-7xl px-6 py-14">
        {/* Centered intro, same rhythm as the homepage hero */}
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-success" />
            </span>
            Step 1 · Pick your vault
          </span>
          <h1 className="mt-6 font-display text-5xl leading-[1.05] tracking-tight md:text-6xl">
            Choose your <span className="brand-text">Vault</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg text-muted-foreground">
            Every vault is a draw settled fully on Solana. Pick a pool, grab a
            ticket, and enter the round in seconds.
          </p>
        </div>

        <VaultPicker />
        <MyTicketsDashboard />
        <WinnerCta />
        <FinishedRounds />
      </main>

      <Footer />
    </div>
  );
}
