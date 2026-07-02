// "How it works" — three-step explainer, ported from the reference maquette.
// No interactivity: this is a Server Component (no "use client"), rendered
// on the server with zero JS shipped to the browser.
// Copy is adapted to OUR program: one round at a time, draw settled on-chain
// (simple randomness for the MVP — Switchboard VRF is the phase-2 upgrade).

const steps = [
  {
    n: "01",
    title: "Connect your wallet",
    desc: "Securely connect your favorite Solana wallet in one click.",
  },
  {
    n: "02",
    title: "Buy a ticket",
    desc: "Pick the vault you want to enter and buy your ticket.",
  },
  {
    n: "03",
    title: "Win the pot",
    desc: "When the draw ends, the winner is paid instantly on-chain.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="relative overflow-hidden bg-secondary/50 pb-14 pt-14">
      {/* Seam bridge with the Hero: white -> transparent gradient so the
          Hero's white background melts into this section's bg-secondary
          instead of switching hard. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-background to-transparent" />
      {/* Same trick at the bottom: fade back to white before WhySolvault. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background to-transparent" />
      <div className="relative mx-auto max-w-7xl px-6">
        {/* Section heading: kicker -> title -> supporting line */}
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-primary">How it works</p>
          <h2 className="mt-2 font-display text-3xl md:text-4xl">
            Transparency Comes Standard.
          </h2>
          <p className="mt-4 text-muted-foreground">
            Every lottery is secured on-chain and paid automatically.
          </p>
        </div>

        {/* Step cards: stacked on mobile, three columns from md */}
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {steps.map((s) => (
            <div
              key={s.n}
              className="card-soft rounded-2xl border border-border bg-card p-5"
            >
              <div className="flex items-center gap-3">
                <span className="grid size-8 place-items-center rounded-lg bg-secondary font-display text-sm text-primary">
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
