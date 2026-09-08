// Site footer — minimal "Rain.fi style": brand, one nav row, separator,
// description paragraphs in small muted text, then a copyright bottom row.
// Static markup -> Server Component.
//
// F10.5 — the description block used to describe an "educational blockchain
// project exploring transparent LOTTERY systems". That product is now a
// side-feature (D42); the flagship is a game you bring real SOL into. Leaving
// the old paragraphs in place would have been the single most misleading text
// on the site, in the one spot readers go looking for the fine print.
//
// Scope note (F0): the legal question is parked by founder decision (D68).
// Nothing here is legal advice or a disclaimer drafted as such — it simply
// stops describing the wrong product and states what the thing actually is.

import Image from "next/image";
import { ARENA_URL } from "@/lib/constants";

// "/#..." (not "#...") so the links also work from other pages (/vaults).
const navLinks = [
  { label: "Home", href: "/#play" },
  { label: "Arena", href: ARENA_URL },
  { label: "How it works", href: "/#how" },
  { label: "Why Nimbo Play", href: "/#why" },
  { label: "FAQ", href: "/#faq" },
  { label: "Lotteries", href: "/vaults" },
];

const legalParagraphs = [
  "Nimbo Play is an independent Web3 project building skill-based multiplayer games on Solana. Nimbo Arena, its first game, is a real-time arena where players bring SOL onto the field and play it against other players.",
  "The platform runs on Solana devnet. Devnet SOL is obtained for free from public faucets and holds no monetary value.",
  "Players compete against each other, never against the house. Entries are escrowed by an on-chain program and every payout settles as a public Solana transaction. Gameplay itself runs on servers we operate, which makes us a trusted party over the outcome of a round — a limitation we document rather than hide.",
  "Nimbo Play does not provide financial services, investment products, or guaranteed rewards. What you take out of a round depends on your own play and on the other players in it, and you can lose everything you bring in.",
  "Blockchain transactions are irreversible and users remain responsible for their own wallets, private keys, and interactions with smart contracts.",
];

export function Footer() {
  return (
    <footer className="border-t border-border bg-background pb-10 pt-16">
      <div className="mx-auto max-w-7xl px-6">
        {/* Brand — the same lockup as the header, at the same h-10, so the top
            and bottom of the page close on an identical mark. The text span
            that used to sit beside the old icon is gone: this asset already
            contains the wordmark. */}
        <div className="flex items-center">
          <Image
            src="/logo-lockup.png"
            alt="Nimbo Play"
            width={760}
            height={235}
            className="h-10 w-auto object-contain"
          />
        </div>

        {/* Nav row */}
        <nav className="mt-8 flex flex-wrap items-center gap-x-7 gap-y-2">
          {navLinks.map((l) => (
            <a
              key={l.label}
              href={l.href}
              className="text-sm font-medium text-foreground/80 hover:text-foreground"
            >
              {l.label}
            </a>
          ))}
        </nav>

        {/* Separator */}
        <div className="mt-8 border-t border-border" />

        {/* Fine print. Rendered as ONE dense block rather than five spaced
            paragraphs: this is the footer's small print, and a compact slab
            reads as such at a glance, where stacked paragraphs demanded the
            same attention as real content.
            The source stays an ARRAY so each statement can be edited, reordered
            or removed on its own — only the rendering joins them. Editing a
            single 900-character string is how sentences get lost.
            11px with 1.5 leading: smaller than the 12px/1.625 it replaces, but
            muted-foreground sits at 7.2:1 on this background, comfortably past
            AA even at this size. */}
        <p className="mt-8 max-w-none text-[11px] leading-[1.5] text-muted-foreground">
          {legalParagraphs.join(" ")}
        </p>
        <p className="mt-3 text-[11px] font-medium leading-[1.5] text-foreground/70">
          Built on Solana.
        </p>

        {/* Bottom row. The "Terms" and "Privacy policy" links that used to sit
            here both pointed at "#" (F10.3): two dead links promising documents
            that do not exist. Removed until there is something to link to —
            an empty promise of terms is worse than no link at all. */}
        <div className="mt-10 flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Nimbo Play. All rights reserved.
          </p>
          <p className="text-sm text-muted-foreground">
            Running on Solana devnet.
          </p>
        </div>
      </div>
    </footer>
  );
}
