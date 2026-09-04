// "How it works" — the three-beat game loop (F6.2).
// No interactivity: Server Component (no "use client"), zero JS shipped.
//
// The loop is stake -> grow -> extract OR die. The old set ended on "try to
// extract the biggest SOL amount possible", which reads like any other
// play-to-earn page and hid the one thing that makes this game tense: you can
// lose everything. That beat now has its own card.
//
// "Connect your wallet" was dropped on purpose. The audience is crypto-native,
// the header already carries a Connect button, and it is the first step of
// every dapp on earth — spending one of three cards on a generic gesture
// diluted the two that are actually ours. The trust point it used to carry
// (your signature authorises every move) belongs in the WhyNimbo section,
// which is the trust section, and lands there in F6.3.
//
// Copy is checked against the locked design decisions rather than written from
// memory: D46 (stake sizes your snake), D47 (70/30 on death), D86 (extraction
// is the only exit — a round ending never pays anyone out).
const steps = [
  {
    n: "01",
    title: "Place your bet",
    // D46 — the mechanic nobody else has, and it was nowhere on the site.
    // Wording is the founder's call. Noted once for whoever reads this later:
    // "bet" is wagering language, and D42 positions this product against
    // exactly that ("human vs human, not player vs casino, skill decides").
    // The program itself calls the amount a `stake` (STAKE_TIERS_SOL), so
    // switching back is a one-word edit here and in the title.
    desc: "From 0.1 SOL to 1 SOL. The more you bet, the bigger you spawn — more power, and a much larger target.",
  },
  {
    n: "02",
    title: "Grow on the field",
    // D47 — nothing on screen is decorative; every pellet is backed by lamports.
    desc: "Eat pellets and the loot dead players drop. Everything on the floor is real SOL.",
  },
  {
    n: "03",
    title: "Extract, or lose it",
    // D47 for the 70%, D86 for "the only way out", EXTRACT_CHANNEL_FRAMES=720
    // (60 fps) for the 12 seconds. The card's title promises the downside, so
    // the copy has to actually state it: leaving the round is the ONLY exit.
    desc: "Reach an extract point and hold it for 12 seconds. Cash out and the SOL is yours — die on the way and 70% of it drops on the floor for someone else.",
  },
];

export function HowItWorks() {
  return (
    // bg-background, not bg-secondary. In the F3 palette --secondary (L 0.227)
    // is LIGHTER than --card (L 0.195), so a secondary section made the cards
    // sink into their own background instead of rising above it.
    <section id="how" className="relative overflow-hidden bg-background pb-14 pt-14">
      <div className="relative mx-auto max-w-7xl px-6">
        {/* Section heading: kicker -> title -> supporting line */}
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-primary">How it works</p>
          <h2 className="mt-2 font-display text-3xl md:text-4xl">
            Play Off-Chain. Paid On-Chain.
          </h2>
          <p className="mt-4 text-muted-foreground">
            Real-time multiplayer gameplay. Every stake and every payout is
            settled by a Solana program.
          </p>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {steps.map((s) => (
            <div
              key={s.n}
              className="card-soft rounded-2xl border border-border bg-card p-5"
            >
              <div className="flex items-center gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary font-display text-sm text-primary">
                  {s.n}
                </span>
                <h3 className="font-display text-lg font-semibold">{s.title}</h3>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
