// Closing CTA (F6.7) — the last thing before the footer.
//
// Why it exists: after the FAQ the page simply stopped, and the only two
// entry points to the product lived a full scroll away in the hero. Someone
// who read the whole page is the most convinced reader we have, and they had
// nothing to click.
//
// It deliberately does NOT repeat the hero's message. The hero sells the
// promise ("Play better. Win bigger."); this one answers the question the FAQ
// just raised — how do I actually start.
//
// It now closes on a SINGLE button, and the live arena runs behind it.
import Link from "next/link";
import { ARENA_URL } from "@/lib/constants";
import { ArenaBackdrop } from "./arena-backdrop";

export function FinalCta() {
  return (
    // Same `grain` overlay as the hero so the page opens and closes on the
    // same texture. The glow is a radial written with the palette's own
    // tokens rather than hardcoded colours — the recurring lesson of F3 is
    // that every hardcoded colour survives the next change of charter.
    <section className="grain relative overflow-hidden bg-background py-24">
      {/* The live arena, running behind the copy (see arena-backdrop.tsx).
          It sits UNDER the two glows below, so the section's own lighting
          ties it in instead of it reading as a pasted-in window. */}
      <ArenaBackdrop />

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

        {/* ONE button (2026-09-09, user's call). Both used to point at the
            same URL anyway — the arena's own menu is where free and paid
            actually part ways, so offering the choice twice only split the
            reader's attention before they had anything to decide with.
            It takes the solid-white PRIMARY treatment: it is now the single
            call to action on the page, and an outline button would have
            ended the page on a whisper. */}
        <div className="mt-10 flex items-center justify-center">
          <Link
            href={ARENA_URL}
            className="rounded-xl bg-white px-6 py-3 text-base font-semibold uppercase tracking-wide text-background transition-transform hover:scale-[1.02]"
          >
            Try for free
          </Link>
        </div>
      </div>
    </section>
  );
}
