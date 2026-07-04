"use client";

// Finished rounds archive: responsive table with "All history / Your
// history" tabs. Client component for the tab state only.
// Data is mock (10.15); real rounds come from the indexer DB in 10.17 —
// this table is exactly what the PostgreSQL cache is for.
import { useState } from "react";

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

export function FinishedRounds() {
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
        {/* Nested radii: outer = inner (10px) + padding (4px) = 14px. */}
        <div className="inline-flex rounded-[14px] border border-border bg-card p-1 shadow-sm">
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
              className={`rounded-[10px] px-4 py-2 text-sm font-medium transition-colors ${
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

      <div className="card-soft mt-6 overflow-hidden rounded-3xl border border-border bg-card">
        {/* Column headers (desktop only) */}
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
