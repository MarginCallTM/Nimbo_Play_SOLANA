// "Why Solvault" (the reference's Trust section): animated code card on the
// left (see code-block.tsx), three trust arguments on the right.
// The reference's treasure chest + coins were replaced 2026-07-02; no state
// needed anymore, so this is a Server Component (no "use client").
// Copy is adapted to OUR program (no VRF claim, winner claims the pot) —
// see CLAUDE.md: never advertise simple on-chain randomness as secure.
import { CodeBlock } from "@/components/site/code-block";
import { HighlightedWord } from "@/components/site/highlighted-word";

const items = [
  {
    title: "Secure by Design",
    desc: "Every ticket is protected by blockchain technology from purchase to payout.",
  },
  {
    title: "Complete Transparency",
    desc: "Every lottery runs entirely on-chain and can be audited by anyone.",
  },
  {
    title: "Winners Paid Instantly",
    desc: "No delays. Just one transaction to receive your prize.",
  },
];

export function WhySolvault() {
  return (
    <section id="why" className="bg-background pb-24 pt-10">
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-6 md:grid-cols-2">
        {/* Left: animated code card showing the real buy_ticket client call —
            the "auditable" argument, shown instead of told. */}
        <div className="relative flex justify-center">
          <CodeBlock />
        </div>

        {/* Right: kicker + heading + trust arguments */}
        <div>
          <p className="text-sm font-medium text-primary">Why Nimbo Play</p>
          {/* HighlightedWord = PointerHighlight filled with the brand
              gradient + the word fading to white during the sweep. */}
          <h2 className="mt-2 font-display text-3xl md:text-4xl">
            Trust the <HighlightedWord>Blockchain.</HighlightedWord>
          </h2>
          <ul className="mt-8 space-y-5">
            {items.map((it) => (
              <li key={it.title} className="flex gap-4">
                <span className="mt-1.5 grid size-4 shrink-0 place-items-center rounded-full border border-primary/40 text-[10px] text-primary">
                  ✓
                </span>
                <div>
                  <h3 className="font-display text-lg font-semibold">
                    {it.title}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">{it.desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
