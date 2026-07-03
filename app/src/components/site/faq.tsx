// FAQ section (the reference's FinalCTA): gradient background, floating
// clouds, heading on the left, shadcn Accordion on the right.
// Static content + the Accordion handles its own open/close state client-side,
// so this section stays a Server Component.
// Copy is adapted to OUR program: single round, winner claims the pot,
// simple on-chain randomness stated honestly (VRF = roadmap), devnet only.
// The reference's "referrals" FAQ was dropped — we have no referral system.
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const faqs = [
  {
    q: "How do I enter the lottery?",
    a: "Connect your Solana wallet and buy a ticket in SOL for the current round. Each ticket is its own on-chain account — that's your entry for the draw.",
  },
  {
    q: "What are the prizes and odds?",
    a: "The pot is the sum of all ticket sales for the round, visible on-chain in real time. One ticket = one chance: your odds are your tickets divided by the total tickets sold.",
  },
  {
    q: "How do I receive my winnings?",
    a: "Once the draw settles, the winner claims the pot in a single transaction — the on-chain vault transfers the SOL straight to their wallet. No forms, no middleman.",
  },
  {
    q: "How do I know this is fair?",
    a: "Every ticket, draw and payout is a public Solana transaction anyone can audit. The current version uses simple on-chain randomness — acceptable on devnet and documented as such; a verifiable VRF draw is on the roadmap before any real-value round.",
  },
  {
    q: "How is this different from traditional lotteries?",
    a: "No middlemen, no opaque accounting. Tickets, prize pool and winner selection all live on Solana and can be verified by anyone, anytime.",
  },
  {
    q: "Is this real money?",
    a: "Not yet. Solvault runs on Solana devnet: tickets are paid in devnet SOL, which has no monetary value. Mainnet would only come after a serious security audit.",
  },
];

export function Faq() {
  return (
    <section
      id="faq"
      className="relative overflow-hidden py-24"
      style={{ background: "var(--gradient-hero)" }}
    >
      <div className="relative mx-auto grid max-w-6xl gap-12 px-6 lg:grid-cols-[1fr_2fr] lg:items-start">
        {/* Left: badge + heading */}
        <div>
          <span className="inline-flex items-center rounded-full border border-border bg-background/60 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            FAQ
          </span>
          <h2 className="mt-4 font-display text-[clamp(2rem,4vw,3rem)] leading-tight">
            Questions, <span className="brand-text">answered.</span>
          </h2>
          <p className="mt-4 max-w-sm text-muted-foreground">
            Everything you need to know about playing the Solana lottery on
            Solvault.
          </p>
          {/* Graduate-cloud mascot (background removed via macOS Vision —
              the source PNG had a fake baked-in checkerboard). In-flow
              rather than absolute so it can never overlap the accordion;
              hidden on mobile where the column is stacked. */}
          <img
            src="/cloud-graduate.png"
            alt=""
            aria-hidden
            width={512}
            height={512}
            className="float-slow mt-10 hidden w-44 lg:block"
          />
        </div>

        {/* Right: one collapsible item per question */}
        <Accordion type="single" collapsible className="space-y-3">
          {faqs.map((item, i) => (
            <AccordionItem
              key={i}
              value={`item-${i}`}
              className="rounded-2xl border border-border bg-background/70 px-5 backdrop-blur transition-colors hover:bg-background/90"
            >
              <AccordionTrigger className="py-5 text-left font-display text-base hover:no-underline md:text-lg">
                {item.q}
              </AccordionTrigger>
              <AccordionContent className="pb-5 leading-relaxed text-muted-foreground">
                {item.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
