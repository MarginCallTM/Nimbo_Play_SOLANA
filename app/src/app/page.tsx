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
import { WhySolvault } from "@/components/site/why-solvault";
import { Faq } from "@/components/site/faq";
import { Footer } from "@/components/site/footer";

export default function Home() {
  return (
    // F3.4 (provisional): the redesign is dark, so the page opts into the
    // `.dark` token set that already exists for /vaults. Doing it with a class
    // here keeps the change to one line and reversible; the proper fix is to
    // make dark the default in globals.css once the palette is settled.
    <div className="dark min-h-screen bg-background text-foreground">
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
