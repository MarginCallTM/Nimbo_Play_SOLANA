// Closing CTA (F6.7) — the last thing before the footer.
//
// Why it exists: after the FAQ the page simply stopped, and the only two
// entry points to the product lived a full scroll away in the hero. Someone
// who read the whole page is the most convinced reader we have, and they had
// nothing to click.
//
// It deliberately does NOT repeat the hero's message. The hero sells the
// promise ("Play better. Win bigger."); this one answers the question the FAQ
// just raised — how do I actually start, and how much do I have to risk to
// find out. Hence the free demo standing on equal footing with the paid path
// (D72/D76: the demo is a separate off-chain sandbox against bots, no wallet,
// no value at stake).
//
// Static markup -> Server Component.
import Link from "next/link";
import { ARENA_URL } from "@/lib/constants";

export function FinalCta() {
  return (
    // Same `grain` overlay as the hero so the page opens and closes on the
    // same texture. The glow is a radial written with the palette's own
    // tokens rather than hardcoded colours — the recurring lesson of F3 is
    // that every hardcoded colour survives the next change of charter.
    <section className="grain relative overflow-hidden bg-background py-24">
      {/* Two soft light sources, indigo above and coral below, echoing the
          artwork's own lighting: the clouds are lit from within, the fire
          from underneath. pointer-events-none so they never eat a click. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 60% at 50% 0%, color-mix(in oklab, var(--primary) 22%, transparent) 0%, transparent 70%), radial-gradient(50% 50% at 50% 100%, color-mix(in oklab, var(--accent) 16%, transparent) 0%, transparent 70%)",
        }}
      />

      <div className="relative z-10 mx-auto flex max-w-3xl flex-col items-center px-6 text-center">
        <h2 className="font-display text-[clamp(2rem,5vw,3.25rem)] font-semibold leading-[0.95] tracking-tight text-white">
          The field is open.
        </h2>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/60">
          Learn the loop against bots for free, or bring 0.1 SOL and play a
          round where the floor is worth something.
        </p>

        {/* Same pairing as the hero — solid white primary, outline secondary —
            so the whole site teaches one button hierarchy. */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            href={ARENA_URL}
            className="rounded-xl bg-white px-6 py-3 text-base font-semibold text-background transition-transform hover:scale-[1.02]"
          >
            Enter the Arena
          </Link>
          <Link
            href={ARENA_URL}
            className="rounded-xl border border-white/20 px-6 py-3 text-base font-medium text-white/80 transition-colors hover:bg-white/5"
          >
            Try the free demo
          </Link>
        </div>

        {/* The honest footnote. Saying it here, right at the point of decision,
            costs nothing and is the same badge the hero opens with (F0). */}
        <p className="mt-6 text-sm text-white/40">
          Devnet SOL only — free from any faucet, no monetary value.
        </p>
      </div>
    </section>
  );
}
