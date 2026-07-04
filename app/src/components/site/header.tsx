// Site header — ported 1:1 from the Lovable maquette (Header section).
// Still a Server Component: ConnectWalletButton is a client LEAF inside it
// (same pattern as HighlightedWord) — the rest of the header renders on the
// server. "mainnet" wording is corrected in 10.16.
// logo-mark.png = official logo, background-removed + trimmed from
// public/official_logo.png (kept as the untouched source).
import Image from "next/image";
import { ConnectWalletButton } from "@/components/site/connect-wallet-button";

export function Header() {
  return (
    <header className="sticky top-0 z-30 w-full border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3.5">
        <a href="/" className="flex items-center gap-2">
          <Image
            src="/logo-mark.png"
            alt="Nimbo Play logo"
            width={64}
            height={64}
            className="size-8 object-contain"
          />
          <span className="font-brand text-lg font-semibold">Nimbo Play</span>
        </a>
        <nav className="hidden items-center gap-1 md:flex">
          {/* "/#..." (not "#...") so anchors also work from /vaults. */}
          {[
            { label: "Lotteries", href: "/vaults" },
            { label: "How it works", href: "/#how" },
            { label: "Winners", href: "#" },
            { label: "Docs", href: "#" },
          ].map((l) => (
            <a
              key={l.label}
              href={l.href}
              className="rounded-full px-3.5 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              {l.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <a
            href="/vaults"
            className="hidden rounded-[10px] border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-secondary sm:inline-flex"
          >
            View lottery
          </a>
          <ConnectWalletButton />
        </div>
      </div>
    </header>
  );
}
