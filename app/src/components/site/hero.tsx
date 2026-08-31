// Hero — front redesign (F4). Replaces the Lovable "candy" hero: the cartoon
// cloud, the wobbling SOL coin, the cobe globe and the fabricated activity
// feed are all gone.
//
// LAYOUT (F4.1): the illustration is NOT a background with text on top. Text
// block first, artwork below, both inside one black section. The artwork's own
// top is black, so the two read as a single continuous scene — and the height
// of the text block stays a CSS value instead of a constraint baked into the
// image. That matters here: the generated art has almost no clear sky left
// once the wall of fire rises, so overlaying a headline on it would fight the
// flames.
//
// Static markup only -> Server Component (no "use client"), zero JS shipped.
import Image from "next/image";
import Link from "next/link";
import { ARENA_URL } from "@/lib/constants";

export function Hero() {
  return (
    // `grain` (globals.css) lays film grain over the WHOLE section, artwork and
    // headline alike, the way grain runs across a printed poster. It also sets
    // isolation:isolate so the blend can't reach the page background.
    // `bg-background` is now the artwork's own black, sampled from the file
    // itself (F3), so section, header and illustration share one value.
    <section id="play" className="grain relative overflow-hidden bg-background">
      <div className="relative z-10 mx-auto flex max-w-3xl flex-col items-center px-6 pb-6 pt-20 text-center md:pt-24">
        {/* Honest status badge (F4.3 / F0): the arena settles real transactions,
            but on devnet SOL. The old badge claimed "Solana mainnet · Round #248"
            and both halves were false. */}
        <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-white/70 backdrop-blur">
          <span className="size-1.5 rounded-full bg-success" />
          Live on Solana devnet
        </span>

        {/* One <h1> only. The previous markup opened an h1 and then left an
            unstyled <h2> dangling underneath, which broke both the visual
            rhythm and the document outline. Two short parallel lines, forced by
            <br>, leading pulled under 1 — the reference sets its headline the
            same way (~76px type on ~70px lines). */}
        <h1 className="mt-8 font-display text-[clamp(2.75rem,7vw,4.75rem)] font-semibold leading-[0.92] tracking-tight text-white">
          Play Better.
          <br />
          Win Bigger.
        </h1>

        {/* The headline is a claim, so the sub-line teaches the actual rule:
            food on the floor IS money (D47 — nothing on screen is decorative),
            and extraction is the only way to keep it (D86 — a round ending is
            never a cash-out). "cash out" is two words here because it is a
            verb; the hyphenated "cash-out" is the noun.
            One line on desktop; max-w-xl matches the width the reference gives
            its own sub-line. */}
        <p className="mt-7 max-w-xl text-lg leading-relaxed text-white/60">
          Everything you eat is real SOL. Extract to cash out.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          {/* Single primary CTA (F4.6). The arena is a separate app on its own
              subdomain, so this is an absolute URL, not a route of this site. */}
          <Link
            href={ARENA_URL}
            className="rounded-xl bg-white px-6 py-3 text-base font-semibold text-background transition-transform hover:scale-[1.02]"
          >
            Enter the Arena
          </Link>
          {/* The free demo is off-chain and needs no wallet (D72/D76) — a real
              friction-free way in, worth showing next to the paid path. */}
          <Link
            href={ARENA_URL}
            className="rounded-xl border border-white/20 px-6 py-3 text-base font-medium text-white/80 transition-colors hover:bg-white/5"
          >
            Try the free demo
          </Link>
        </div>
      </div>

      {/* Artwork band.
          The source is 3841x2144 and its top ~26% is pure black — dead space
          that stacked onto the text block's own padding and produced a black
          gap roughly twice as tall as the reference's. So the band is a
          container with a WIDER ratio than the image (3841/1650 vs 3841/2144);
          `object-cover` scales the art to the full width and `object-bottom`
          anchors it low, so the surplus is trimmed off the TOP. About 23% goes,
          leaving only a thin strip of black for the glow to rise into.
          Calibrated against the reference, which keeps ~55px between the CTA
          row and the first artwork; at 1700 some 60px of dead black survived on
          top of the text block's own padding and the gap came out twice as
          wide. Retune by moving the second number only: lower = tighter crop.
          `relative` (not absolute) so the band takes real height and pushes the
          page down on its own — no magic offsets to keep in sync. */}
      {/* Mobile uses a TALLER ratio (3/2) on purpose. At 425px the desktop crop
          is only ~183px tall and the cabinet shrinks to nothing; a taller box
          makes object-cover scale up and trim the SIDES instead, which costs
          only empty cloud and keeps the subject readable. Provisional answer to
          F1.8/F11.1 — a purpose-framed portrait asset would still be better. */}
      <div className="relative aspect-[3/2] w-full md:aspect-[3841/1650]">
        <Image
          src="/Official_bg_webp.webp"
          alt=""
          aria-hidden
          fill
          sizes="100vw"
          // Next 16 renamed `priority` to `preload`. This is the LCP image, so
          // it gets a <link rel=preload> in <head> instead of waiting for the
          // layout pass to discover it.
          preload
          className="object-cover object-bottom"
        />
        {/* The crop leaves a hard edge where the section's black meets the
            artwork's slightly different black. This melts one into the other. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-background to-transparent" />
      </div>
    </section>
  );
}
