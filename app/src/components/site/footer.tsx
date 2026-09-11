// Site footer — minimal "Rain.fi style": description paragraphs in small muted
// text, then a bottom row carrying the brand lockup and the copyright.
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
        {/* 2026-09-11 (user's call), two removals that reshaped this block:
            - the nav row (Home / Arena / How it works / Why Nimbo Play / FAQ /
              Lotteries), which duplicated the header's navigation one screen
              below it, every target an anchor on the page just scrolled;
            - the brand lockup that opened the footer. It now CLOSES it, in the
              bottom row, so the mark is the last thing on the page.
            The inner separator went with them. It used to divide the brand and
            nav from the fine print; with both gone it would have drawn a second
            rule 64px under the footer's own `border-t`, with nothing in
            between. The footer's top border is the separation now, which is why
            the fine print below carries no top margin — `pt-16` already
            provides the whole gap. */}

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
        <p className="max-w-none text-[11px] leading-[1.5] text-muted-foreground">
          {legalParagraphs.join(" ")}
        </p>
        <p className="mt-3 text-[11px] font-medium leading-[1.5] text-foreground/70">
          Built on Solana.
        </p>

        {/* Bottom row — now BRAND left, copyright right.
            The "Terms" and "Privacy policy" links that used to sit here both
            pointed at "#" (F10.3): two dead links promising documents that do
            not exist. Removed until there is something to link to — an empty
            promise of terms is worse than no link at all.
            "Running on Solana devnet." stood on the right until 2026-09-11.
            That status is NOT lost: the fine print above still states it in
            full ("The platform runs on Solana devnet. Devnet SOL is obtained
            for free from public faucets and holds no monetary value."), so the
            footer says it once instead of twice. GOLIVE.md G5 tracks both. */}
        <div className="mt-10 flex flex-wrap items-center justify-between gap-4">
          {/* Same lockup, same h-10 as the header, so the top and bottom of the
              page still close on an identical mark — only its position moved.
              The asset already contains the wordmark, hence no text beside it. */}
          <Image
            src="/logo-lockup.png"
            alt="Nimbo Play"
            width={760}
            height={235}
            className="h-10 w-auto object-contain"
          />
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Nimbo Play. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
