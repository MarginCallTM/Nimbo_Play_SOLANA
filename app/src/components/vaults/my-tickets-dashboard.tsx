"use client";

// "My dashboard" banner + modal (integrated from a provided snippet,
// restyled to the vault page language: square action buttons, palette
// tokens, card-soft shadow — layout kept as-is).
// ALL data here is MOCK (wallet, tickets, stats): there is no wallet
// connection yet. Real wallet + indexer reads land in 10.6/10.17.
// Client component: modal open state + Escape key listener.
import { useEffect, useState } from "react";
import { DashboardCard } from "./dashboard-card";

type UserTicket = {
  id: string;
  vault: string;
  round: number;
  tickets: number;
  spent: number;
  odds: string;
  drawsIn: string;
  status: "live" | "settled";
  result?: "won" | "lost";
  prize?: number;
};

const userTickets: UserTicket[] = [
  { id: "T-2481", vault: "Daily Vault", round: 248, tickets: 12, spent: 0.6, odds: "1 in 78", drawsIn: "04h 21m", status: "live" },
  { id: "T-2467", vault: "Daily Vault", round: 247, tickets: 5, spent: 0.25, odds: "1 in 184", drawsIn: "Settled", status: "settled", result: "lost" },
  { id: "T-2452", vault: "Weekly Vault", round: 245, tickets: 8, spent: 0.4, odds: "1 in 88", drawsIn: "Settled", status: "settled", result: "won", prize: 964 },
];

function StatCell({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-secondary/40 px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 font-display text-lg tabular-nums ${accent ? "brand-text" : ""}`}>{value}</p>
    </div>
  );
}

export function MyTicketsDashboard() {
  const [open, setOpen] = useState(false);

  const activeTickets = userTickets
    .filter((t) => t.status === "live")
    .reduce((n, t) => n + t.tickets, 0);
  const activeVaults = new Set(
    userTickets.filter((t) => t.status === "live").map((t) => t.vault),
  ).size;
  const totalSpent = userTickets.reduce((s, t) => s + t.spent, 0).toFixed(2);
  const nextDraw = userTickets.find((t) => t.status === "live")?.drawsIn ?? "—";

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <section className="mt-20">
      <div className="card-soft relative overflow-hidden rounded-[28px] border border-border bg-card p-6 md:p-8">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full opacity-20 blur-3xl"
          style={{ background: "var(--gradient-brand)" }}
        />
        <div className="relative flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4">
            <div
              className="grid size-12 shrink-0 place-items-center rounded-2xl text-primary-foreground"
              style={{ background: "var(--gradient-brand)" }}
            >
              <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4V7z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 5v14" strokeDasharray="2 3" />
              </svg>
            </div>
            <div>
              <span className="text-xs font-bold uppercase tracking-widest text-primary/80">
                My dashboard
              </span>
              <h2 className="mt-1 font-display text-3xl tracking-tight md:text-4xl">
                Your vault tickets
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Track every ticket, round and payout tied to your wallet.
              </p>
            </div>
          </div>

          <div className="grid w-full grid-cols-2 gap-3 md:w-auto md:grid-cols-4">
            <StatCell label="Active tickets" value={activeTickets.toString()} />
            <StatCell label="Live vaults" value={activeVaults.toString()} />
            <StatCell label="Total staked" value={`${totalSpent} SOL`} />
            <StatCell label="Next draw" value={nextDraw} accent />
          </div>
        </div>

        <div className="relative mt-6 flex flex-col-reverse gap-3 md:flex-row md:items-center md:justify-between">
          <p className="text-xs text-muted-foreground">
            Data pulled live from Solana. Read-only — we never move funds.
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="group inline-flex items-center justify-center gap-2 rounded-[10px] px-6 py-3 text-sm font-semibold text-primary-foreground cta-glow transition-transform hover:scale-[1.02]"
            style={{ background: "var(--gradient-brand)" }}
          >
            Open my dashboard
            <svg viewBox="0 0 24 24" className="size-4 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Modal shell (backdrop, Escape, click-outside) kept; the content is
          now the animated DashboardCard. */}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="My dashboard"
          className="fixed inset-0 z-50 flex items-end justify-center bg-background/60 p-4 backdrop-blur-md md:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            className="relative w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close dashboard"
              className="absolute -right-2 -top-2 z-20 grid size-9 place-items-center rounded-[10px] border border-border bg-card text-muted-foreground shadow-sm hover:text-foreground"
            >
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M6 18L18 6" />
              </svg>
            </button>
            <DashboardCard />
          </div>
        </div>
      )}
    </section>
  );
}
