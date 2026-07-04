"use client";

// Vault selection (left) + sticky ticket summary (right).
// One client component on purpose: selectedId/tickets are shared between
// the two columns, so the state must live in their common parent.
// Live feel: a 1s interval drives the countdowns, a 2.2s interval simulates
// ticket purchases (mock — replaced by on-chain reads in 10.17). Initial
// values are deterministic (soldStart/potStart) so SSR and hydration match;
// randomness only ever runs client-side inside the intervals.
// Corporate restyle vs the reference: icon tiles instead of floating chests,
// palette tokens instead of raw Tailwind colors, softer selection ring.
import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Sunrise, CalendarDays, Gem } from "lucide-react";
import { vaults, formatCountdown, type Vault } from "./vaults-data";

const VAULT_ICONS = {
  sunrise: Sunrise,
  grand: CalendarDays,
  diamond: Gem,
} as const;

type LiveStat = { sold: number; pot: number; secondsLeft: number };

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
    // Countdown tick.
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

    // Simulated ticket purchases on live vaults.
    const sales = setInterval(() => {
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

function VaultCard({
  vault,
  live,
  isSelected,
  justBumped,
  onSelect,
}: {
  vault: Vault;
  live: LiveStat;
  isSelected: boolean;
  justBumped: boolean;
  onSelect: () => void;
}) {
  const Icon = VAULT_ICONS[vault.id as keyof typeof VAULT_ICONS] ?? Sunrise;
  const ticketsLeft = Math.max(0, vault.capacity - live.sold);
  const progress = Math.min(100, (live.sold / vault.capacity) * 100);

  return (
    <button
      type="button"
      disabled={vault.comingSoon}
      onClick={onSelect}
      className={`group relative block w-full text-left transition-all duration-300 ${
        vault.comingSoon
          ? "cursor-not-allowed opacity-60"
          : "cursor-pointer hover:-translate-y-0.5"
      }`}
    >
      <div
        className={`card-soft relative flex flex-col items-center gap-6 rounded-3xl border bg-card p-6 md:flex-row md:p-7 ${
          isSelected
            ? "border-primary ring-1 ring-primary/30"
            : "border-border group-hover:border-primary/40"
        }`}
      >
        {/* Thumbnail: illustration when the vault has one, icon tile otherwise. */}
        {vault.image ? (
          <div className="relative size-23 shrink-0">
            <Image
              src={vault.image}
              alt={vault.name}
              width={160}
              height={160}
              className={`size-full object-contain transition-transform duration-300 ${
                vault.comingSoon ? "" : "group-hover:scale-105"
              }`}
            />
          </div>
        ) : (
          <div
            className={`grid size-16 shrink-0 place-items-center rounded-2xl transition-colors ${
              isSelected
                ? "bg-primary/10 text-primary"
                : "bg-secondary/60 text-muted-foreground group-hover:bg-primary/5 group-hover:text-primary"
            }`}
          >
            <Icon className="size-7" strokeWidth={1.75} />
          </div>
        )}

        {/* Title + status + description */}
        <div className="flex-1 text-center md:text-left">
          <div className="flex flex-wrap items-center justify-center gap-3 md:justify-start">
            <h3 className="font-display text-2xl tracking-tight">{vault.name}</h3>
            {vault.comingSoon ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                <span className="size-1.5 rounded-full bg-gold" /> Coming soon
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
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-success" />
                </span>
                Live
              </span>
            )}
          </div>
          <p className="mt-1 text-sm font-medium text-muted-foreground">{vault.desc}</p>
        </div>

        {/* Meta column: price, countdown, progress, pot */}
        <div className="w-full shrink-0 space-y-3 md:w-[280px]">
          <div className="flex items-baseline justify-between gap-3">
            <div className="font-display text-2xl tabular-nums">
              {vault.price} <span className="text-base text-muted-foreground">SOL</span>
              <span className="ml-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                / ticket
              </span>
            </div>
            <div
              className={`rounded-full border px-2 py-0.5 font-mono text-[11px] tabular-nums ${
                vault.comingSoon
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
                  className={`tabular-nums text-foreground ${
                    justBumped && !vault.comingSoon ? "animate-pulse" : ""
                  }`}
                >
                  {ticketsLeft.toLocaleString("en-US")}
                </span>{" "}
                tickets left
              </span>
              <span className="tabular-nums text-muted-foreground">
                {live.sold.toLocaleString("en-US")}/{vault.capacity.toLocaleString("en-US")}
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
              className={`font-display tabular-nums ${
                justBumped && !vault.comingSoon ? "text-success" : "text-foreground"
              }`}
            >
              {live.pot.toLocaleString("en-US", { maximumFractionDigits: 2 })} SOL
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

export function VaultPicker() {
  const [selectedId, setSelectedId] = useState<string>("sunrise");
  const [tickets, setTickets] = useState(1);
  const { stats, bumpKey } = useLiveVaultStats();

  const selected = vaults.find((v) => v.id === selectedId)!;
  const total = (selected.price * tickets).toFixed(3);

  return (
    <div className="mt-14 grid items-start gap-10 lg:grid-cols-12">
      {/* LEFT — vault list */}
      <section className="lg:col-span-8">
        <div className="space-y-4">
          {vaults.map((v) => (
            <VaultCard
              key={v.id}
              vault={v}
              live={stats[v.id]}
              isSelected={v.id === selectedId}
              justBumped={bumpKey?.startsWith(v.id) ?? false}
              onSelect={() => setSelectedId(v.id)}
            />
          ))}
        </div>
      </section>

      {/* RIGHT — sticky ticket summary */}
      <aside className="relative lg:col-span-4">
        <div className="card-soft sticky top-24 rounded-3xl border border-border bg-card p-6">
          <p className="text-sm font-medium text-primary">Step 2 · Confirm your ticket</p>
          <h2 className="mt-1 font-display text-2xl">{selected.name}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {selected.tag} vault · closes in{" "}
            {formatCountdown(stats[selected.id].secondsLeft)}
          </p>

          <div className="mt-6">
            <label className="text-xs uppercase tracking-wide text-muted-foreground">
              Number of tickets
            </label>
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setTickets((n) => Math.max(1, n - 1))}
                className="grid size-10 place-items-center rounded-[10px] border border-border bg-background text-lg font-semibold hover:bg-secondary"
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
                className="grid size-10 place-items-center rounded-[10px] border border-border bg-background text-lg font-semibold hover:bg-secondary"
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
                  className={`flex-1 rounded-[10px] border px-2 py-1 text-xs font-medium transition-colors ${
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
              <span className="brand-text font-display text-lg tabular-nums">{total} SOL</span>
            </div>
          </div>

          {/* Mock CTA — wired to the real buy_ticket instruction in 10.17. */}
          <button
            type="button"
            disabled={selected.comingSoon}
            className={`mt-6 w-full rounded-full px-4 py-3.5 text-sm font-semibold transition-transform ${
              selected.comingSoon
                ? "cursor-not-allowed bg-secondary text-muted-foreground"
                : "cta-glow text-primary-foreground hover:scale-[1.01]"
            }`}
            style={selected.comingSoon ? undefined : { background: "var(--gradient-brand)" }}
          >
            {selected.comingSoon ? "Coming soon" : "Connect wallet"}
          </button>

          <p className="mt-3 text-center text-[11px] text-muted-foreground">
            You&apos;ll sign the transaction with your connected wallet. Every
            ticket is recorded on-chain.
          </p>
        </div>
      </aside>
    </div>
  );
}
