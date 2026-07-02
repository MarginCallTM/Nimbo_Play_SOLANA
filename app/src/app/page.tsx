// Landing page. We assemble the maquette section by section here.
// Order (from the reference): Ticker -> Header -> Hero -> ... -> Footer.
import { Ticker } from "@/components/site/ticker";
import { Header } from "@/components/site/header";
import { Hero } from "@/components/site/hero";
import { HowItWorks } from "@/components/site/how-it-works";
import { WhySolvault } from "@/components/site/why-solvault";
import { Faq } from "@/components/site/faq";
import { Footer } from "@/components/site/footer";

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Ticker />
      <Header />
      <main>
        <Hero />
        {/* Deliberate change from the reference: HowItWorks comes right
            after the Hero (reference had Lotteries first). */}
        <HowItWorks />
        <WhySolvault />
        {/* Lotteries & Stats sections were skipped (2026-07-02): the round
            card will live in the Hero/play area once wired to real data. */}
        <Faq />
      </main>
      <Footer />
    </div>
  );
}
