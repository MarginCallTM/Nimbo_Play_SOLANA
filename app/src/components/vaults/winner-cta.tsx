// "Are you a winner?" banner — static markup, Server Component.
// The Connect wallet CTA is a mock until the wallet adapter lands (10.6).
// GlowBorder (client leaf) adds the golden pointer-tracked border glow;
// it wraps the card because the card's own overflow-hidden would clip the
// blurred halo. Same rounded-[32px] so the ring hugs the corners.
import { Check, Zap, ArrowRight } from "lucide-react";
import { GlowBorder } from "@/components/ui/glow-border";

// Reassurance row under the pitch — all three are TRUE for a read-only
// wallet scan (no custody, no signature, just RPC reads).
const reassurances = [
  "Non-custodial",
  "No signature required",
  "Instant on-chain check",
];

export function WinnerCta() {
  return (
    <section className="mt-24">
      <GlowBorder className="rounded-[32px]">
      <div className="card-soft relative overflow-hidden rounded-[32px] border border-border bg-card p-10 md:p-14">
        {/* Soft brand glows in the corners */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full opacity-20 blur-3xl"
          style={{ background: "var(--gradient-brand)" }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-16 size-80 rounded-full opacity-15 blur-3xl"
          style={{ background: "var(--gradient-brand)" }}
        />
        <div className="relative flex flex-col items-center gap-10 text-center md:flex-row md:justify-between md:text-left">
          <div className="max-w-xl">
            {/* Urgency badge — numbers are MOCK (10.17: real unclaimed total
                from the indexer). Gold = winner theme, matches the glow. */}
            <span className="inline-flex items-center gap-2 rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-gold">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-gold" />
              </span>
              12.4 SOL unclaimed · 3 rounds pending
            </span>
            <h2 className="mt-5 font-display text-5xl leading-[1.05] tracking-tight md:text-6xl">
              You might already
              <br />
              <span className="brand-text">have won.</span>
            </h2>
            <p className="mt-4 text-muted-foreground">
              Connect your wallet in one click — we&apos;ll instantly scan
              every Nimbo Play round and surface any prize waiting for you
              on-chain.
            </p>
            <ul className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs font-medium text-muted-foreground md:justify-start">
              {reassurances.map((t) => (
                <li key={t} className="inline-flex items-center gap-1.5">
                  <Check className="size-3.5 text-primary" strokeWidth={3} />
                  {t}
                </li>
              ))}
            </ul>
          </div>

          {/* CTA stack: one primary action, one low-friction fallback.
              Both are mocks until the wallet adapter lands (10.6). */}
          <div className="flex w-full max-w-xs shrink-0 flex-col items-stretch gap-3">
            <a
              href="#"
              className="cta-glow inline-flex items-center justify-center gap-2 rounded-[10px] px-6 py-4 text-sm font-semibold text-primary-foreground transition-transform hover:scale-[1.02]"
              style={{ background: "var(--gradient-brand)" }}
            >
              <Zap className="size-4" fill="currentColor" strokeWidth={0} />
              Check my wallet now
              <ArrowRight className="size-4" />
            </a>
            <a
              href="#"
              className="inline-flex items-center justify-center rounded-[10px] border border-border bg-background px-6 py-3.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
            >
              Paste a wallet address instead
            </a>
            <p className="text-center text-[11px] text-muted-foreground">
              Supports Phantom, Solflare, Backpack &amp; more.
            </p>
          </div>
        </div>
      </div>
      </GlowBorder>
    </section>
  );
}
