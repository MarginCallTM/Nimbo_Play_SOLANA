// Site header — front redesign (F5.1/F5.2), modelled on the reference layout:
// wordmark left, navigation centred, two pill actions right.
//
// The centring is done with a three-column grid whose side columns are both
// `1fr`, NOT with flex `justify-between`. With flex the nav would sit wherever
// the logo and the button group happened to leave room, so it would drift every
// time a label changed length; equal side columns pin it to the true centre.
//
// Server Component: ConnectWalletButton is the only client leaf inside it.
import Image from "next/image";
import { ConnectWalletButton } from "@/components/site/connect-wallet-button";
import { MobileNav } from "@/components/site/mobile-nav";
import { ARENA_URL } from "@/lib/constants";

// TODO F8 — points at the docs site once it exists.
const DOCS_HREF = "#";

// Arena comes first: since the 2026-07-10 pivot it is the flagship and the
// lottery is the side-feature. It is an absolute URL because the game is a
// separate app on its own subdomain, not a route of this site.
// No "Docs" entry here: the Documentation button on the right already covers
// it, and two routes to the same page in one bar just splits the click.
// TODO F7 — Leaderboard is a placeholder until that page exists.
const navLinks = [
  { label: "Arena", href: ARENA_URL },
  { label: "Leaderboard", href: "#" },
  { label: "Lotteries", href: "/vaults" },
];

export function Header() {
  return (
    // Exactly the hero's black, fully opaque, and no bottom border: the header
    // has to dissolve into the artwork rather than sit in its own bar.
    // It is OPAQUE on purpose. At /80 the header let the PAGE background show
    // through, and back when that token was a blue-tinted dark the two blacks
    // never matched. Solid also makes backdrop-blur pointless, hence its
    // removal: nothing passes behind an opaque surface. (Now that
    // --background IS the artwork's black, transparency could come back —
    // worth revisiting if the frosted-glass scroll effect is wanted.)
    // Trade-off accepted: no frosted-glass effect when scrolling past the hero.
    // `relative` so the mobile panel can anchor itself with `top-full` instead
    // of hardcoding the header's height.
    <header className="sticky top-0 z-50 w-full bg-background relative">
      {/* Flex below md, grid from md. The centring grid only earns its keep
          once the nav is visible; on a phone its equal 1fr columns just crush
          the wordmark onto two lines. */}
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 md:grid md:grid-cols-[1fr_auto_1fr]">
        <a href="/" className="flex items-center gap-2 justify-self-start">
          <Image
            src="/logo-mark.png"
            alt="Nimbo Play logo"
            width={64}
            height={64}
            className="size-7 object-contain"
          />
          <span className="whitespace-nowrap font-brand text-lg font-semibold text-white">
            Nimbo Play
          </span>
        </a>

        <nav className="hidden items-center gap-8 md:flex">
          {navLinks.map((l) => (
            <a
              key={l.label}
              href={l.href}
              className="text-sm text-white/70 transition-colors hover:text-white"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2 justify-self-end">
          {/* Outline pill = secondary, solid white = primary. Same pairing as
              the reference, and the same pairing as the hero's two CTAs, so
              the page teaches the hierarchy once. */}
          <a
            href={DOCS_HREF}
            className="hidden rounded-full border border-white/20 px-4 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/5 sm:inline-flex"
          >
            Documentation
          </a>
          <ConnectWalletButton />
          {/* Below md only. Gets the same links as the desktop nav so the two
              can never drift out of sync. */}
          <MobileNav links={navLinks} docsHref={DOCS_HREF} />
        </div>
      </div>
    </header>
  );
}
