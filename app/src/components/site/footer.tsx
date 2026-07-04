// Site footer — minimal "Rain.fi style" (2026-07-03 redesign, replaces the
// multi-column layout): brand, one nav row, separator, legal/description
// paragraphs in small muted text, then a copyright / legal-links bottom row.
// Static markup -> Server Component. Nav points to on-page anchors; legal
// links are placeholders until those pages exist.

import Image from "next/image";

// "/#..." (not "#...") so the links also work from other pages (/vaults).
const navLinks = [
  { label: "Home", href: "/#play" },
  { label: "Lotteries", href: "/vaults" },
  { label: "How it works", href: "/#how" },
  { label: "Why Nimbo Play", href: "/#why" },
  { label: "FAQ", href: "/#faq" },
];

// User-provided disclaimer copy (2026-07-03) — honest educational framing.
const legalParagraphs = [
  "Nimbo Play is an educational blockchain project exploring transparent lottery systems built on Solana.",
  "The platform demonstrates how decentralized technologies can create verifiable, on-chain experiences where tickets, draws, and transactions can be publicly inspected.",
  "Nimbo Play uses Solana smart contracts to provide a transparent lottery mechanism where users interact directly through their wallets. The project focuses on blockchain education, smart contract development, and decentralized application design.",
  "Nimbo Play does not provide financial services, investment products, or guaranteed rewards. All interactions are part of an experimental blockchain application designed for learning and research purposes.",
  "Blockchain transactions are irreversible and users remain responsible for their own wallets, private keys, and interactions with smart contracts.",
];

export function Footer() {
  return (
    <footer className="border-t border-border bg-background pb-10 pt-16">
      <div className="mx-auto max-w-7xl px-6">
        {/* Brand — same official logo mark as the header (the old "S" tile
            was a Solvault artifact). */}
        <div className="flex items-center gap-2">
          <Image
            src="/logo-mark.png"
            alt="Nimbo Play logo"
            width={64}
            height={64}
            className="size-8 object-contain"
          />
          <span className="font-brand text-lg font-semibold text-foreground">
            Nimbo Play
          </span>
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

        {/* Legal / description block */}
        <div className="mt-8 space-y-3 text-xs leading-relaxed text-muted-foreground">
          {legalParagraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          <p className="font-medium text-foreground/70">Built on Solana.</p>
        </div>

        {/* Bottom row: copyright left, legal links right */}
        <div className="mt-10 flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Nimbo Play. All rights reserved.
          </p>
          <div className="flex items-center gap-6 text-sm">
            <a
              href="#"
              className="text-foreground/80 hover:text-foreground"
            >
              Terms
            </a>
            <a
              href="#"
              className="text-foreground/80 hover:text-foreground"
            >
              Privacy policy
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
