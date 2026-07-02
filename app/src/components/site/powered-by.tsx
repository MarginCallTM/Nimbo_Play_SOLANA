// "Powered by" logo row at the bottom of the Hero.
// History: started as the maquette's marquee, then a sparkles "planet" design
// test (see sparkles-horizon.tsx) — dropped 2026-07-02 because the glowing
// band blocked a smooth transition into the HowItWorks section below.
const logos = [
  { src: "/solana.png", alt: "Solana" },
  { src: "/phantom.png", alt: "Phantom" },
  { src: "/jupiter.png", alt: "Jupiter" },
  { src: "/superteam.svg", alt: "Superteam" },
  { src: "/solflare.svg", alt: "Solflare" },
];

export function PoweredBy() {
  return (
    <div className="relative mx-auto max-w-7xl px-6 pb-10 pt-10">
      <p className="text-center text-xs uppercase tracking-widest text-muted-foreground">
        Powered by
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
        {logos.map((l) => (
          <span
            key={l.alt}
            className="inline-flex items-center gap-2 font-display text-sm text-foreground/80"
          >
            <img src={l.src} alt={l.alt} className="size-6 rounded-md" />
            {l.alt}
          </span>
        ))}
      </div>
    </div>
  );
}
