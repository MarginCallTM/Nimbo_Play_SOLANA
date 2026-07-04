import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import purpleChest from "@/assets/purple-chest.png.asset.json";
import treasureChest from "@/assets/chest-wallpaper.png.asset.json";
import mysteriousChest from "@/assets/mysterious-chest-purple.png.asset.json";
import cuteCloud from "@/assets/cute-cloud.png.asset.json";
import cloudCute from "@/assets/cloud-cute.png.asset.json";

export const Route = createFileRoute("/vaults")({
  head: () => ({
    meta: [
      { title: "Choose your vault — Solvault" },
      { name: "description", content: "Select a vault, pick your ticket amount and enter the round. Provably fair, settled on Solana." },
      { property: "og:title", content: "Choose your vault — Solvault" },
      { property: "og:description", content: "Select a vault, pick your ticket amount and enter the round." },
    ],
  }),
  component: VaultsPage,
});

type Vault = {
  id: string;
  tag: string;
  name: string;
  pot: string;
  price: number;
  players: string;
  closes: string;
  odds: string;
  image: string;
  comingSoon: boolean;
  accent: string;
  capacity: number;
  soldStart: number;
  potStart: number;
  endsInSec: number;
};

const vaults: Vault[] = [
  {
    id: "sunrise",
    tag: "Daily",
    name: "Sunrise Vault",
    pot: "1,284 SOL",
    price: 0.05,
    players: "842",
    closes: "04h 21m",
    odds: "1 in 842",
    image: purpleChest.url,
    comingSoon: false,
    accent: "var(--gradient-brand)",
    capacity: 1200,
    soldStart: 842,
    potStart: 1284,
    endsInSec: 4 * 3600 + 21 * 60,
  },
  {
    id: "grand",
    tag: "Weekly",
    name: "Grand Treasury",
    pot: "12,438 SOL",
    price: 0.1,
    players: "3,418",
    closes: "2d 11h",
    odds: "1 in 3,418",
    image: treasureChest.url,
    comingSoon: true,
    accent: "linear-gradient(135deg, oklch(0.75 0.16 60), oklch(0.7 0.18 30))",
    capacity: 5000,
    soldStart: 3418,
    potStart: 12438,
    endsInSec: 2 * 86400 + 11 * 3600,
  },
  {
    id: "diamond",
    tag: "Monthly",
    name: "Diamond Hoard",
    pot: "48,210 SOL",
    price: 0.25,
    players: "9,107",
    closes: "14d 02h",
    odds: "1 in 9,107",
    image: mysteriousChest.url,
    comingSoon: true,
    accent: "linear-gradient(135deg, oklch(0.7 0.18 200), oklch(0.65 0.2 260))",
    capacity: 12000,
    soldStart: 9107,
    potStart: 48210,
    endsInSec: 14 * 86400 + 2 * 3600,
  },
];

type LiveStat = { sold: number; pot: number; secondsLeft: number };

function formatCountdown(sec: number): string {
  if (sec <= 0) return "Draw closed";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (d > 0) return `${d}d ${pad(h)}h ${pad(m)}m ${pad(s)}s`;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function useLiveVaultStats() {
  const initial = useMemo<Record<string, LiveStat>>(() => {
    const out: Record<string, LiveStat> = {};
    for (const v of vaults) {
      out[v.id] = { sold: v.soldStart, pot: v.potStart, secondsLeft: v.endsInSec };
    }
    return out;
  }, []);
  const [stats, setStats] = useState<Record<string, LiveStat>>(initial);
  const [bumpKey, setBumpKey] = useState<string | null>(null);

  useEffect(() => {
    const tick = setInterval(() => {
      setStats((prev) => {
        const next: Record<string, LiveStat> = {};
        for (const v of vaults) {
          const cur = prev[v.id];
          next[v.id] = { ...cur, secondsLeft: Math.max(0, cur.secondsLeft - 1) };
        }
        return next;
      });
    }, 1000);

    const sales = setInterval(() => {
      // Simulate ticket purchases on live vaults
      const live = vaults.filter((v) => !v.comingSoon);
      if (live.length === 0) return;
      const v = live[Math.floor(Math.random() * live.length)];
      const bought = 1 + Math.floor(Math.random() * 4);
      setStats((prev) => {
        const cur = prev[v.id];
        const remaining = Math.max(0, v.capacity - cur.sold);
        const buy = Math.min(bought, remaining);
        if (buy === 0) return prev;
        return {
          ...prev,
          [v.id]: {
            ...cur,
            sold: cur.sold + buy,
            pot: +(cur.pot + buy * v.price).toFixed(3),
          },
        };
      });
      setBumpKey(`${v.id}-${Date.now()}`);
    }, 2200);

    return () => {
      clearInterval(tick);
      clearInterval(sales);
    };
  }, []);

  return { stats, bumpKey };
}

function VaultsPage() {
  const [selectedId, setSelectedId] = useState<string>("sunrise");
  const [tickets, setTickets] = useState(1);
  const { stats, bumpKey } = useLiveVaultStats();

  const selected = vaults.find((v) => v.id === selectedId)!;
  const total = (selected.price * tickets).toFixed(3);

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      {/* Soft ambient background matching the home hero */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, oklch(0.95 0.05 260 / 0.55) 0%, transparent 70%), linear-gradient(180deg, oklch(0.99 0.01 260) 0%, oklch(1 0 0) 60%)",
        }}
      />
      <img
        src={cuteCloud.url}
        alt=""
        aria-hidden
        className="pointer-events-none absolute -left-16 top-40 -z-10 hidden w-64 opacity-70 float-y md:block"
      />
      <img
        src={cloudCute.url}
        alt=""
        aria-hidden
        className="pointer-events-none absolute right-8 top-24 -z-10 hidden w-40 opacity-60 float-y md:block"
        style={{ animationDelay: "1.2s" }}
      />

      {/* Header — matches home */}
      <header className="sticky top-0 z-30 w-full border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3.5">
          <Link to="/" className="flex items-center gap-2">
            <span
              className="grid size-8 place-items-center rounded-xl text-primary-foreground font-display text-sm"
              style={{ background: "var(--gradient-brand)" }}
            >S</span>
            <span className="font-display text-lg tracking-tight">Solvault</span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            <Link to="/vaults" className="rounded-full bg-secondary px-3.5 py-2 text-sm font-medium text-foreground">Vaults</Link>
            <a href="/#how-it-works" className="rounded-full px-3.5 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground">How it works</a>
            <a href="/#winners" className="rounded-full px-3.5 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground">Winners</a>
            <a href="#" className="rounded-full px-3.5 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground">Docs</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link to="/" className="hidden rounded-full border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-secondary sm:inline-flex">
              View lottery
            </Link>
            <a href="#" className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-primary-foreground cta-glow" style={{ background: "var(--gradient-brand)" }}>
              <span className="size-1.5 rounded-full bg-white/90" /> Connect wallet
            </a>
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-7xl px-6 py-14">
        {/* Centered intro, matches home hero rhythm */}
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
            </span>
            Step 1 · Pick your vault
          </span>
          <h1 className="mt-6 font-display text-5xl leading-[1.05] tracking-tight md:text-6xl">
            Choose your <span className="brand-text">Vault</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg text-muted-foreground">
            Every vault is a provably fair draw settled on Solana. Pick a pool,
            grab a ticket, and enter the round in seconds.
          </p>
        </div>

        <div className="mt-14 grid gap-10 lg:grid-cols-12 items-start">
          {/* LEFT — editorial vault stack */}
          <section className="lg:col-span-8">
            <div className="space-y-4">
              {vaults.map((v) => {
                const isSelected = v.id === selectedId;
                const live = stats[v.id];
                const ticketsLeft = Math.max(0, v.capacity - live.sold);
                const progress = Math.min(100, (live.sold / v.capacity) * 100);
                const justBumped = bumpKey?.startsWith(v.id);
                return (
                  <button
                    key={v.id}
                    type="button"
                    disabled={v.comingSoon}
                    onClick={() => setSelectedId(v.id)}
                    className={`group relative block w-full text-left transition-all duration-300 ${
                      v.comingSoon ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:-translate-y-1"
                    }`}
                  >
                    {isSelected && !v.comingSoon && (
                      <div
                        className="absolute -inset-0.5 rounded-[32px] opacity-25 blur"
                        style={{ background: "var(--gradient-brand)" }}
                      />
                    )}
                    <div
                      className={`relative flex flex-col items-center gap-6 rounded-[28px] border bg-card p-6 shadow-sm md:flex-row md:p-7 ${
                        isSelected
                          ? "border-2 border-primary"
                          : "border-border group-hover:border-primary/40 group-hover:shadow-xl"
                      }`}
                    >
                      {/* Chest thumbnail */}
                      <div
                        className={`grid size-20 shrink-0 place-items-center rounded-2xl transition-colors ${
                          isSelected ? "bg-gradient-to-br from-primary/10 to-success/10" : "bg-secondary/60 group-hover:bg-primary/5"
                        }`}
                      >
                        <img
                          src={v.image}
                          alt=""
                          width={80}
                          height={80}
                          loading="lazy"
                          className="size-16 object-contain float-y"
                        />
                      </div>

                      {/* Title + description */}
                      <div className="flex-1 text-center md:text-left">
                        <div className="flex flex-wrap items-center justify-center gap-3 md:justify-start">
                          <h3 className="font-display text-2xl tracking-tight">{v.name}</h3>
                          {v.comingSoon ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                              <span className="size-1.5 rounded-full bg-amber-500" /> Coming soon
                            </span>
                          ) : isSelected ? (
                            <span
                              className="rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-primary-foreground"
                              style={{ background: "var(--gradient-brand)" }}
                            >
                              Selected
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                              <span className="relative flex size-1.5">
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                                <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
                              </span>
                              Live
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-sm font-medium text-muted-foreground">
                          {v.tag === "Daily" && "Daily draws with high frequency wins."}
                          {v.tag === "Weekly" && "Weekly compounding prize pools."}
                          {v.tag === "Monthly" && "Monthly mega-jackpot draws."}
                        </p>
                      </div>

                      {/* Right meta */}
                      <div className="w-full md:w-[280px] shrink-0 space-y-3">
                        <div className="flex items-baseline justify-between gap-3">
                          <div className="font-display text-2xl tabular-nums">
                            {v.price}{" "}
                            <span className="text-base text-muted-foreground">SOL</span>
                            <span className="ml-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">/ ticket</span>
                          </div>
                          <div
                            key={live.secondsLeft}
                            className={`rounded-full border px-2 py-0.5 font-mono text-[11px] tabular-nums ${
                              v.comingSoon
                                ? "border-border text-muted-foreground"
                                : "border-primary/30 bg-primary/5 text-primary"
                            }`}
                            title="Time until draw"
                          >
                            {formatCountdown(live.secondsLeft)}
                          </div>
                        </div>

                        <div>
                          <div className="mb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            <span>
                              <span
                                className={`tabular-nums text-foreground ${justBumped && !v.comingSoon ? "animate-pulse" : ""}`}
                              >
                                {ticketsLeft.toLocaleString("en-US")}
                              </span>{" "}
                              tickets left
                            </span>
                            <span className="tabular-nums text-muted-foreground">
                              {live.sold.toLocaleString("en-US")}/{v.capacity.toLocaleString("en-US")}
                            </span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                            <div
                              className="h-full rounded-full transition-[width] duration-700 ease-out"
                              style={{ width: `${progress}%`, background: "var(--gradient-brand)" }}
                            />
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-bold uppercase tracking-wider text-muted-foreground">
                            Total staked
                          </span>
                          <span
                            className={`font-display tabular-nums ${justBumped && !v.comingSoon ? "text-success" : "text-foreground"}`}
                          >
                            {live.pot.toLocaleString("en-US", { maximumFractionDigits: 2 })} SOL
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* RIGHT — Ticket summary (unchanged) */}
          <aside className="relative lg:col-span-4">
            <div className="sticky top-24 rounded-3xl border border-border bg-card p-6 shadow-xl">
              <p className="text-sm font-medium text-primary">Step 2 · Confirm your ticket</p>
              <h2 className="mt-1 font-display text-2xl">{selected.name}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {selected.tag} vault · closes in {selected.closes}
              </p>

              <div className="mt-6">
                <label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Number of tickets
                </label>
                <div className="mt-2 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setTickets((n) => Math.max(1, n - 1))}
                    className="grid size-10 place-items-center rounded-full border border-border bg-background text-lg font-semibold hover:bg-secondary"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={1}
                    value={tickets}
                    onChange={(e) => setTickets(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full rounded-xl border border-border bg-background px-4 py-2 text-center font-display text-2xl tabular-nums outline-none focus:border-primary"
                  />
                  <button
                    type="button"
                    onClick={() => setTickets((n) => n + 1)}
                    className="grid size-10 place-items-center rounded-full border border-border bg-background text-lg font-semibold hover:bg-secondary"
                  >
                    +
                  </button>
                </div>
                <div className="mt-3 flex gap-2">
                  {[1, 5, 10, 25].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setTickets(n)}
                      className={`flex-1 rounded-full border px-2 py-1 text-xs font-medium transition-colors ${
                        tickets === n
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-background text-muted-foreground hover:bg-secondary"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-6 space-y-2 rounded-2xl bg-secondary/60 p-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Ticket price</span>
                  <span className="tabular-nums">{selected.price} SOL</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Quantity</span>
                  <span className="tabular-nums">× {tickets}</span>
                </div>
                <div className="mt-2 flex justify-between border-t border-border/60 pt-2">
                  <span className="font-medium">Total</span>
                  <span className="font-display text-lg tabular-nums brand-text">{total} SOL</span>
                </div>
              </div>

              <button
                type="button"
                disabled={selected.comingSoon}
                className={`mt-6 w-full rounded-full px-4 py-3.5 text-sm font-semibold transition-transform ${
                  selected.comingSoon
                    ? "cursor-not-allowed bg-secondary text-muted-foreground"
                    : "text-primary-foreground cta-glow hover:scale-[1.01]"
                }`}
                style={selected.comingSoon ? undefined : { background: "var(--gradient-brand)" }}
              >
                {selected.comingSoon ? "Coming soon" : `Confirm & buy ${tickets} ticket${tickets > 1 ? "s" : ""}`}
              </button>

              <p className="mt-3 text-center text-[11px] text-muted-foreground">
                You'll sign the transaction with your connected wallet. Provably fair via Switchboard VRF.
              </p>
            </div>
          </aside>
        </div>

        {/* Winner check CTA */}
        <section className="mt-24">
          <div className="relative overflow-hidden rounded-[32px] border border-border bg-card p-10 shadow-xl md:p-14">
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
            <div className="relative flex flex-col items-center gap-8 text-center md:flex-row md:justify-between md:text-left">
              <div className="max-w-xl">
                <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
                  <span className="relative flex size-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-75" />
                    <span className="relative inline-flex size-1.5 rounded-full bg-amber-500" />
                  </span>
                  Payouts settled on-chain
                </span>
                <h2 className="mt-4 font-display text-4xl leading-tight tracking-tight md:text-5xl">
                  Are you a winner?{" "}
                  <span className="brand-text">Check now.</span>
                </h2>
                <p className="mt-3 text-muted-foreground">
                  Connect your wallet to see your entries, past rounds and
                  unclaimed prizes across every Solvault draw.
                </p>
              </div>
              <a
                href="#"
                className="inline-flex shrink-0 items-center gap-2 rounded-full px-6 py-4 text-sm font-semibold text-primary-foreground cta-glow hover:scale-[1.02] transition-transform"
                style={{ background: "var(--gradient-brand)" }}
              >
                <span className="size-1.5 rounded-full bg-white/90" />
                Connect wallet
              </a>
            </div>
          </div>
        </section>

        {/* Finished rounds */}
        <FinishedRounds />
      </main>
    </div>
  );
}

type Round = {
  id: number;
  vault: string;
  winner: string;
  amount: number;
  players: number;
  when: string;
  isYou?: boolean;
};

const allRounds: Round[] = [
  { id: 247, vault: "Sunrise Vault", winner: "7xKq…9fPa", amount: 1842, players: 921, when: "2h ago" },
  { id: 246, vault: "Sunrise Vault", winner: "Bv2m…hLZ4", amount: 1210, players: 812, when: "6h ago" },
  { id: 245, vault: "Sunrise Vault", winner: "3nRe…kQ8w", amount: 964, players: 704, when: "11h ago" },
  { id: 244, vault: "Sunrise Vault", winner: "9pLd…2vXo", amount: 720, players: 640, when: "1d ago" },
  { id: 243, vault: "Sunrise Vault", winner: "Ht4c…mZ7y", amount: 512, players: 581, when: "1d ago" },
  { id: 242, vault: "Sunrise Vault", winner: "Ck8v…qA3n", amount: 388, players: 512, when: "2d ago" },
];

const yourRounds: Round[] = [
  { id: 245, vault: "Sunrise Vault", winner: "You (3nRe…kQ8w)", amount: 964, players: 704, when: "11h ago", isYou: true },
  { id: 241, vault: "Sunrise Vault", winner: "F2xa…7pQm", amount: 0, players: 488, when: "3d ago" },
  { id: 238, vault: "Sunrise Vault", winner: "K9wL…mR3p", amount: 0, players: 402, when: "5d ago" },
];

function FinishedRounds() {
  const [tab, setTab] = useState<"all" | "yours">("all");
  const rows = tab === "all" ? allRounds : yourRounds;

  return (
    <section className="mt-20">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <span className="text-xs font-bold uppercase tracking-widest text-primary/80">
            Archive
          </span>
          <h2 className="mt-2 font-display text-3xl tracking-tight md:text-4xl">
            Finished Rounds
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every completed draw, verifiable on Solana.
          </p>
        </div>
        <div className="inline-flex rounded-full border border-border bg-card p-1 shadow-sm">
          {(
            [
              { key: "all", label: "All history" },
              { key: "yours", label: "Your history" },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                tab === t.key
                  ? "text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              style={tab === t.key ? { background: "var(--gradient-brand)" } : undefined}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
        <div className="hidden grid-cols-12 gap-4 border-b border-border/60 bg-secondary/40 px-6 py-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground md:grid">
          <div className="col-span-2">Round</div>
          <div className="col-span-3">Vault</div>
          <div className="col-span-3">Winner</div>
          <div className="col-span-2 text-right">Prize</div>
          <div className="col-span-2 text-right">When</div>
        </div>

        {rows.length === 0 ? (
          <div className="px-6 py-14 text-center text-sm text-muted-foreground">
            No rounds yet. Connect your wallet to see your history.
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {rows.map((r) => (
              <li
                key={`${tab}-${r.id}`}
                className={`grid grid-cols-2 items-center gap-4 px-6 py-4 text-sm transition-colors md:grid-cols-12 ${
                  r.isYou ? "bg-primary/5" : "hover:bg-secondary/40"
                }`}
              >
                <div className="col-span-2 font-display tabular-nums">#{r.id}</div>
                <div className="col-span-3 text-muted-foreground">{r.vault}</div>
                <div className="col-span-3 flex items-center gap-2 font-mono text-xs">
                  {r.isYou && (
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                      You
                    </span>
                  )}
                  <span className="truncate">{r.winner}</span>
                </div>
                <div className="col-span-2 text-right font-display tabular-nums">
                  {r.amount > 0 ? (
                    <span className="text-success">
                      +{r.amount.toLocaleString("en-US")} SOL
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </div>
                <div className="col-span-2 text-right text-xs text-muted-foreground">
                  {r.when}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
