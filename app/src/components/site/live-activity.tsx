"use client";

// Live activity feed for the Hero's right column.
// Uses the AnimatedList primitive to reveal ARENA events (entries + cash-outs)
// as a stack of notifications, newest on top.
//
// The rows below are SAMPLE data — the arena server exposes no public stats
// endpoint yet, so nothing here is live. The card footer says so out loud
// (AF.2(g)): a wallet-connect page must not display invented traffic as real.
import { AnimatedList } from "@/components/ui/animated-list";
import Jazzicon from "react-jazzicon";

type Activity = {
  id: number;
  kind: "cashout" | "entry";
  addr: string;
  amount: number; // SOL: the stake locked in (entry) or the payout taken (cashout)
  match: number;
  ago: string;
};

const sol = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 });

// Deterministic seed for jazzicon. Our sample addresses aren't valid hex, so the
// package's jsNumberForAddress would yield NaN — we hash the whole string
// instead so each address always maps to the same unique icon.
function seedFromAddr(addr: string): number {
  let h = 0;
  for (let i = 0; i < addr.length; i++) {
    h = (h * 31 + addr.charCodeAt(i)) >>> 0; // keep it an unsigned 32-bit int
  }
  return h;
}

// Sample stream, most recent last (AnimatedList reveals in order). Amounts
// stay inside the real economy: entries match the menu tiers (0.1 / 0.25 /
// 0.5 / 1 SOL, shared/src/index.ts) and a cash-out pays what the snake grew
// to — a few multiples of the stake, never a jackpot.
const activity: Activity[] = [
  { id: 1, kind: "entry", addr: "Ck8v…qA3n", amount: 1, match: 1482, ago: "5m" },
  { id: 2, kind: "cashout", addr: "7xKq…9fPa", amount: 2.15, match: 1478, ago: "2h" },
  { id: 3, kind: "entry", addr: "9pLd…2vXo", amount: 0.5, match: 1482, ago: "8m" },
  { id: 4, kind: "entry", addr: "Bv2m…hLZ4", amount: 0.25, match: 1482, ago: "12m" },
  { id: 5, kind: "cashout", addr: "3nRe…kQ8w", amount: 1.86, match: 1481, ago: "6h" },
  { id: 6, kind: "entry", addr: "Ht4c…mZ7y", amount: 0.5, match: 1482, ago: "15m" },
  { id: 7, kind: "cashout", addr: "Rp5t…Wq2b", amount: 0.74, match: 1480, ago: "11h" },
  { id: 8, kind: "entry", addr: "Kf9n…Lm4d", amount: 0.1, match: 1482, ago: "20m" },
  { id: 9, kind: "entry", addr: "Zx3w…Pv7k", amount: 1, match: 1482, ago: "22m" },
  { id: 10, kind: "cashout", addr: "Nb6y…Tc8r", amount: 3.4, match: 1479, ago: "1d" },
];

function ActivityCard({ kind, addr, amount, match, ago }: Activity) {
  const isCashout = kind === "cashout";
  return (
    <div className="relative mx-auto w-full overflow-hidden rounded-2xl border border-border bg-background/70 p-3 transition-all duration-200 ease-in-out hover:scale-[1.02] hover:border-primary/40">
      <div className="flex items-center gap-3">
        {/* Jazzicon identicon derived from the address (MetaMask-style) */}
        <span className="flex size-10 flex-shrink-0 overflow-hidden rounded-full">
          <Jazzicon diameter={40} seed={seedFromAddr(addr)} />
        </span>

        <div className="min-w-0 flex-1">
          <h5 className="truncate text-sm font-semibold text-foreground">
            <span className="font-mono">{addr}</span>{" "}
            {isCashout ? "cashed out" : "entered the arena"}
          </h5>
          <p className="truncate text-xs text-muted-foreground">
            Match #{match} · {ago}
          </p>
        </div>

        {/* Right value in SOL: the payout taken (green) or the stake locked in */}
        <div className="text-right">
          <div
            className={`text-sm font-semibold ${isCashout ? "text-success" : "text-foreground"}`}
          >
            +{sol(amount)} SOL
          </div>
          <div className="text-[10px] text-muted-foreground">
            {isCashout ? "Paid on-chain" : "to the vault"}
          </div>
        </div>
      </div>
    </div>
  );
}

export function LiveActivity() {
  return (
    <div className="relative mx-auto w-full max-w-md">
      {/* Soft brand glow behind the panel */}
      <div
        className="absolute -inset-4 rounded-3xl opacity-40 blur-2xl"
        style={{ background: "var(--gradient-brand)" }}
      />
      <div className="relative rounded-2xl border border-border bg-card/90 p-5 shadow-2xl backdrop-blur">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-success" />
            </span>
            Live arena
          </div>
          <span className="text-xs text-muted-foreground">Match #1482</span>
        </div>

        {/* Animated feed (fixed height, older items fade under the gradient) */}
        <div className="relative mt-4 h-80 overflow-hidden">
          <AnimatedList delay={1200} maxVisible={5} className="gap-3">
            {activity.map((a) => (
              <ActivityCard key={a.id} {...a} />
            ))}
          </AnimatedList>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-card to-transparent" />
        </div>

        {/* Footer */}
        <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-3 text-xs text-muted-foreground">
          <span>Sample data · devnet</span>
          <a href="/games" className="font-medium text-foreground hover:underline">
            View all games →
          </a>
        </div>
      </div>
    </div>
  );
}
