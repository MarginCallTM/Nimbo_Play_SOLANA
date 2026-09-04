// "Why Nimbo Play" — the trust section (F6.3). Animated code card on the left
// (see code-block.tsx), three trust arguments on the right.
// No state -> Server Component (no "use client").
//
// Every claim below is checked against the code, not written from memory:
//   - 5.5% rake  -> RAKE_BPS=550 (docker-compose.yml, settlement/src/main.rs)
//   - vault PDA  -> programs/arena/src/lib.rs (join deposits into the vault)
//   - off-chain gameplay, on-chain settlement -> D44/D45
//
// What this section must NOT say (F0 + D44): the old copy claimed "every
// lottery runs ENTIRELY ON-CHAIN". Transposed to the arena that would be a
// lie — the game loop runs on our authoritative server; only escrow, the
// anti-replay guard and the payouts are enforced by the Solana program.
// Saying that out loud is a stronger trust signal than pretending otherwise,
// and it is the one claim a competitor cannot copy by writing prettier copy.
import { CodeBlock } from "@/components/site/code-block";
import { HighlightedWord } from "@/components/site/highlighted-word";

const items = [
  {
    // D42/D62 — the positioning statement: human vs human, never player vs house.
    title: "The house never plays",
    desc: "Every SOL you take comes from another player. We take 5.5% when you enter, and nothing after that.",
  },
  {
    // The custody point, repatriated from how-it-works where it used to be
    // stated as the false "we never hold your funds" (F10, D54/D45).
    title: "Your stake never touches our wallet",
    desc: "Deposits go into a program-owned vault. Every entry and every payout is a public Solana transaction you can check yourself.",
  },
  {
    // D44/D45 — admitting the trust boundary instead of hiding it.
    title: "Fast game, verifiable money",
    desc: "The arena runs on our servers so it stays smooth. The escrow, the anti-replay guard and the payouts are enforced by a Solana program.",
  },
];

export function WhyNimbo() {
  return (
    <section id="why" className="bg-background pb-24 pt-10">
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-6 md:grid-cols-2">
        {/* Left: animated code card showing the real arena `join` client call —
            the "auditable" argument, shown instead of told. */}
        {/* min-w-0: same reason as inside CodeBlock — a grid item defaults to
            min-width:auto and would otherwise be stretched by the code card's
            longest line, pushing the page into horizontal scroll on mobile. */}
        <div className="relative flex min-w-0 justify-center">
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
