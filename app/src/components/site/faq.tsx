// FAQ section (F6.5): heading on the left, shadcn Accordion on the right.
// Static content + the Accordion handles its own open/close state client-side,
// so this section stays a Server Component.
//
// This whole block used to be a LOTTERY faq (odds, buying a ticket, the draw,
// VRF). Rewritten for the arena. Every number below is read from the code,
// never from memory — the economy constants are balancing knobs (D75/D82/D83)
// and will drift, so this list is a sync point:
//   0.1 -> 1 SOL      arena/shared/src/index.ts  STAKE_TIERS_SOL
//   5.5% rake         RAKE_BPS=550 (docker-compose.yml, settlement/src/main.rs)
//   70 / 30 on death  arena/shared/src/index.ts  RECYCLE_RATIO = 0.3
//   12s channel       arena/shared/src/index.ts  EXTRACT_CHANNEL_FRAMES = 720
//
// F0 rules that shaped the answers: no yield is promised, no invented
// statistic, and the trust boundary (off-chain gameplay, on-chain settlement)
// is admitted rather than glossed over (D44/D45).
//
// TRIMMED ON THE FOUNDER'S CALL — three entries were cut from this list, and
// each one carried a fact F0 requires the SITE to keep stating somewhere. They
// all survive elsewhere; if any of those places is ever rewritten, the fact has
// to land somewhere or the site quietly starts lying again:
//   "Who holds my SOL?" -> custody. Now only in WhyNimbo #2 ("Your stake never
//        touches our wallet"). Replaces the old FALSE claim "we never hold your
//        funds" (D54/D45), so this one matters most.
//   "What do you take?" -> the 5.5% rake. Still in WhyNimbo #1, in "How much
//        does it cost to play?" and in "Are there bots?".
//   "Is this real money?" -> devnet status. Still in the hero badge, the
//        closing CTA and twice in the footer.
import Image from "next/image";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { DOCS_URL } from "@/lib/constants";

const faqs = [
  {
    q: "What is Nimbo Arena?",
    a: "A real-time multiplayer arena where you bring SOL onto the field and play it with your own reflexes. You grow by eating what is on the ground, and you leave with whatever you managed to carry out. Skill decides the outcome — there is no draw, no roll, no house edge on the result.",
  },
  {
    q: "How much does it cost to play?",
    // D46 — the variable buy-in is the mechanic nobody else has.
    a: "You choose: 0.1, 0.25, 0.5 or 1 SOL. Your bet is not just an entry fee, it is your starting size — bet more and you spawn bigger, with more power and a much larger target painted on you. There is also a free demo against bots, with no SOL involved at all.",
  },
  {
    q: "What happens when I die?",
    // D47 (70/30) + the 2026-08-06 amendment: disconnecting kills you.
    a: "You lose what you were carrying, and it stays in the game: 70% drops on the spot as a corpse anyone can eat, and 30% is recycled into pellets across the map. Nothing is burned and nothing goes to us. Quitting mid-run does not save you either — disconnecting kills your snake immediately and drops the corpse.",
  },
  {
    q: "How do I cash out?",
    // D86 — extraction is the only exit; a round ending never pays anyone.
    a: "Extract points appear on the map periodically. Reach one and hold it for 12 seconds without dying — you stay fully vulnerable the whole time, and everyone can see you doing it. Finish the channel and the SOL is sent to your wallet. That is the only way out: waiting for the clock to run out never pays you.",
  },
  {
    q: "Is the game itself on-chain?",
    // D44/D45 — the trust boundary, said out loud.
    a: "No, and we would rather say so. The arena runs on our own authoritative server, because a blockchain cannot tick a 60 fps game. That server decides who ate whom, so it is a trusted party over real money. What the Solana program guarantees regardless is the escrow, the anti-replay guard and the payouts. Decentralising the settlement authority is on the roadmap, not shipped.",
  },
  {
    q: "Are there bots?",
    // D78 — owning the doctrine publicly is a differentiator.
    a: "Almost certainly, and a bot that actually plays the game is welcome: it risks its own SOL, it pays the same 5.5% on entry, and it dies like everyone else. Bring your reflexes or bring your code. What we do fight is abuse rather than skill — exploiting mechanics, dodging death by pulling the plug, multi-account packs hunting a lone human, or seeing through the fog.",
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
        {/* Left: badge + heading + mascot + a pointer to the docs.
            The graduate-cloud mascot that used to sit here was a leftover from
            the candy/lottery template — a pastel sticker in front of a painted
            dark scene. Replaced by a 3D arcade cabinet on a nimbus cloud, which
            carries the artwork's three motifs at once: the cabinet, the wall of
            fire and the violet nimbus (F3). */}
        <div>
          <span className="inline-flex items-center rounded-full border border-border bg-background/60 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            FAQ
          </span>
          <h2 className="mt-4 font-display text-[clamp(2rem,4vw,3rem)] leading-tight">
            Questions, <span className="brand-text">answered.</span>
          </h2>
          <p className="mt-4 max-w-sm text-muted-foreground">
            The rules, the money, and what we do and do not control.
          </p>
          {/* F8.7 — restored, but GATED. This link was written and then held
              back in comment form because it would have 404'd: the docs site
              did not exist, and shipping a fresh dead link in the very release
              that removed the old ones (F10.3) would have been self-defeating.
              The condition is what makes it safe to keep in the tree — DOCS_URL
              is an empty string until NEXT_PUBLIC_DOCS_URL is set at build
              time, so this renders nothing until the site is actually live. */}
          {DOCS_URL && (
            <a
              href={DOCS_URL}
              className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
            >
              Read the documentation <span aria-hidden>→</span>
            </a>
          )}

          {/* Decorative only -> alt="" + aria-hidden, so a screen reader skips
              it instead of announcing a filename.
              The render ships on a flat #0a090d background, which sits 1/255
              from the section's own #09080d — below the perception threshold,
              so no cut-out is needed and the rectangle is invisible.
              In-flow (not absolute) so it can never overlap the accordion, and
              hidden below lg where the column is stacked and the mascot would
              only push the questions further down.
              next/image, unlike the raw <img> this replaces, serves a resized
              WebP/AVIF and reserves the box from width/height (F12.2). */}
          <Image
            src="/mascot-arcade.png"
            alt=""
            aria-hidden
            width={660}
            height={768}
            sizes="176px"
            className="float-idle mt-10 hidden w-44 lg:block"
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
