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
      {/* pb-0: the text block no longer pads itself away from the artwork. The
          gradient at the top of the band already melts the junction, so the
          padding was buying nothing but height. */}
      <div className="relative z-10 mx-auto flex max-w-3xl flex-col items-center px-6 pb-0 pt-20 text-center md:pt-24">
        {/* The "Live on Solana devnet" status pill used to open this block. It
            was removed on purpose (2026-09-07, user's call) to raise the
            artwork: the headline now starts the page and the illustration
            arrives sooner. Devnet status is still stated on the homepage, in
            the footer's fine print and in the page metadata — the closing CTA's
            footnote was removed on 2026-09-09 (user's call) and the footer's
            second mention ("Running on Solana devnet.") on 2026-09-11, so this
            list keeps thinning. GOLIVE.md G5 holds the full inventory.
            IF A BADGE EVER COMES BACK HERE, it states devnet. The one this
            replaced claimed "Solana mainnet · Round #248" and both halves were
            false (F0 / F10.1). */}

        {/* One <h1> only. The previous markup opened an h1 and then left an
            unstyled <h2> dangling underneath, which broke both the visual
            rhythm and the document outline. Two short parallel lines, forced by
            <br>, leading pulled under 1 — the reference sets its headline the
            same way (~76px type on ~70px lines).
            No top margin: it carried the gap under the status pill, and with
            the pill gone it would just re-add the height we set out to save. */}
        <h1 className="font-display text-[clamp(2.75rem,7vw,4.75rem)] font-semibold leading-[0.92] tracking-tight text-white">
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
          The source has a tall band of pure black on top — dead space that
          would stack onto the text block's own padding and produce a black gap
          roughly twice as tall as the reference's. So the band is a container
          with a WIDER ratio than the image (1672/720 vs 1672/941);
          `object-cover` scales the art to the full width and `object-bottom`
          anchors it low, so the surplus is trimmed off the TOP, leaving only a
          thin strip of black for the glow to rise into.
          Retune by moving the second number only: lower = tighter crop.
          MEASURED HEADROOM (2026-09-11, testupsalehero.webp, 1672x941). Rows
          are black up to 24.9% of the height; the first real content — the
          flame glow and the cloud tops — lands at 25.3%. So:
            720 -> 23.5% crop  (current) leaves ~1.8% of black for the glow
            703 -> 25.3%       ABSOLUTE FLOOR, content touches the top edge
          The previous asset (Official_bg_webp.webp, 3841x2144) measured 26.5%
          and ran at 3841/1620; the two crops are within a point of each other,
          which is why the band barely changes shape.
          `relative` (not absolute) so the band takes real height and pushes the
          page down on its own — no magic offsets to keep in sync. */}
      {/* Mobile uses a TALLER ratio (3/2) on purpose. At 425px the desktop crop
          is only ~183px tall and the cabinet shrinks to nothing; a taller box
          makes object-cover scale up and trim the SIDES instead, which costs
          only empty cloud and keeps the subject readable. Provisional answer to
          F1.8/F11.1 — a purpose-framed portrait asset would still be better. */}
      <div className="relative aspect-[3/2] w-full md:aspect-[1672/720]">
        <Image
          src="/testupsalehero.webp"
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
