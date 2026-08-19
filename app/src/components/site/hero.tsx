// Hero section — ported from the Lovable maquette (main block).
// Stateless + only static images -> Server Component (no "use client").
// Images live in /public and are referenced with plain <img> to match the
// maquette 1:1 (next/image could alter layout/aspect; fidelity first).
//
// AF.2(g) — the copy sells the ARENA, not the lottery, and says devnet.
// The old badge claimed "Solana mainnet · Round #248": both were false.
import Link from "next/link";
import { PoweredBy } from "@/components/site/powered-by";
import { LiveActivity } from "@/components/site/live-activity";
import { GlobeAnalytics } from "@/components/site/globe-analytics";
import { ARENA_URL } from "@/lib/constants";

export function Hero() {
  return (
    <section
      id="play"
      className="relative overflow-hidden"
      style={{ background: "var(--gradient-hero)" }}
    >
      {/* Bottom fade-to-white: gradient-hero isn't fully white yet at the
          section's end, so this overlay turns the background pure white from
          the PoweredBy row down, matching HowItWorks' white top gradient.
          First child on purpose: positioned siblings below (content, logos)
          paint above it, so nothing gets washed out. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-80 bg-gradient-to-b from-transparent to-background to-40%" />

      {/* Floating cute cloud — top left */}
      <div className="pointer-events-none absolute left-6 top-10 w-[11.7rem] md:w-[14.3rem] lg:w-[16.9rem]">
        <img
          src="/cloud-cute.png"
          alt=""
          aria-hidden
          className="w-full drop-shadow-xl"
          style={{ animation: "float-y 6s ease-in-out infinite" }}
        />
        <span
          aria-hidden
          className="float-shadow"
          style={{ animation: "shadow-pulse 6s ease-in-out infinite" }}
        />
      </div>

      <div className="relative mx-auto max-w-6xl px-6 pt-28 pb-16 md:pt-36">
        {/* Floating SOL coin — top-right of the headline block */}
        <div className="pointer-events-none absolute right-2 top-6 z-10 w-16 sm:right-6 sm:w-20 md:w-24 lg:right-8 lg:w-28">
          <img
            src="/solana-coin-left.png"
            alt=""
            aria-hidden
            className="w-full"
            style={{ animation: "candy-wobble 5s ease-in-out infinite" }}
          />
          <span
            aria-hidden
            className="float-shadow float-shadow--sm"
            style={{ animation: "shadow-pulse 5s ease-in-out infinite" }}
          />
        </div>

        {/* Headline block — kept centered above the two-column showcase */}
        <div className="flex flex-col items-center text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur animate-fade-in">
            <span className="size-1.5 rounded-full bg-success" /> Live on Solana devnet
          </span>
          <h1 className="mt-6 font-display text-[clamp(2.5rem,7vw,5.5rem)] leading-[0.95] tracking-tight animate-fade-in lg:whitespace-nowrap">
            Skill Pays. <span className="brand-text">On Solana.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted-foreground animate-fade-in">
            Stake to enter a real-time arena. Grow, dodge the lobby, and cash out before someone takes you down.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3 animate-fade-in">
            {/* Main CTA -> vault selection. next/link = client-side nav +
                prefetch when the link enters the viewport. */}
            <Link
              href={ARENA_URL}
              className="inline-flex items-center gap-3 rounded-[10px] px-5 py-3 text-base font-semibold text-primary-foreground cta-glow transition-transform hover:scale-[1.02]"
              style={{ background: "var(--gradient-brand)" }}
            >
              Enter the Arena
            </Link>
          </div>
        </div>

        {/* Two-column showcase: smaller chest (left) + live leaderboard (right).
            Stacks vertically on mobile, side-by-side from lg. */}
        <div className="mt-16 grid items-center gap-10 lg:grid-cols-2 lg:gap-8">
          {/* Interactive globe (corporate look) — replaces the treasure chest */}
          <div className="relative mx-auto w-full max-w-[27.6rem] lg:mx-0">
            <GlobeAnalytics />
          </div>

          {/* Live activity feed (fabricated devnet data — see component header) */}
          <LiveActivity />
        </div>
      </div>

      {/* Partner logos — plain row; the sparkles band was dropped for a
          cleaner transition into HowItWorks. */}
      <PoweredBy />
    </section>
  );
}
