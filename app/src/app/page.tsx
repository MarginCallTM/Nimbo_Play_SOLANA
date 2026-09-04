// Landing page. We assemble the page section by section here.
// Order: Header -> Hero -> ... -> Footer.
//
// F6.1 — the scrolling Ticker was removed from the home. Every row in it was
// invented ("Round #248 closes in 04h 21m", "Bv2m…hLZ4 won 184 SOL") and the
// top of a page that asks you to connect a wallet is the worst possible place
// for fiction. The component still exists because /vaults renders it; that
// page gets the same treatment in F9.
import { Header } from "@/components/site/header";
import { Hero } from "@/components/site/hero";
import { HowItWorks } from "@/components/site/how-it-works";
import { WhyNimbo } from "@/components/site/why-nimbo";
import { Faq } from "@/components/site/faq";
import { FinalCta } from "@/components/site/final-cta";
import { Footer } from "@/components/site/footer";

export default function Home() {
  return (
    // The `dark` class now lives on <html> (layout.tsx) so <body> is dark too.
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <main>
        <Hero />
        {/* Deliberate change from the reference: HowItWorks comes right
            after the Hero (reference had Lotteries first). */}
        <HowItWorks />
        <WhyNimbo />
        {/* Lotteries & Stats sections were skipped (2026-07-02): the round
            card will live in the Hero/play area once wired to real data. */}
        <Faq />
        {/* F6.7 — closing CTA: the reader who got this far had nothing left
            to click, and both entry points were a full scroll away. */}
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
