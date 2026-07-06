"use client";

// TEMP — 10.9 verification block. Proves the whole 10.4→10.9 chain in the
// browser (env → constants → PDA → read-only Program → react-query).
// DELETE once 10.17 wires real data into the actual sections.
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useLottery } from "@/hooks/use-lottery";
import { CURRENT_ROUND_ID } from "@/lib/constants";

export function LotteryDebug() {
  const { data, isPending, error } = useLottery();

  return (
    <div className="mx-auto mt-8 max-w-xl rounded-[10px] border border-dashed border-success/60 bg-card/60 p-4 font-mono text-xs text-muted-foreground">
      <p className="mb-2 font-semibold text-foreground">
        [TEMP] on-chain read — round {CURRENT_ROUND_ID}
      </p>
      {isPending && <p>fetching devnet…</p>}
      {error && <p className="text-destructive">error: {error.message}</p>}
      {data === null && <p>account not found (round not initialized)</p>}
      {data && (
        <ul className="space-y-1">
          {/* u64s arrive as BN (bigger than JS float precision) — .toString()
              is always safe; the pot is in lamports, convert for display. */}
          <li>state: {Object.keys(data.state)[0]}</li>
          <li>tickets sold: {data.totalTickets.toString()}</li>
          <li>pot: {data.potAmount.toNumber() / LAMPORTS_PER_SOL} SOL</li>
          <li>
            ends:{" "}
            {new Date(data.endTimestamp.toNumber() * 1000).toLocaleString()}
          </li>
          <li>winner index: {data.winnerIndex?.toString() ?? "—"}</li>
        </ul>
      )}
    </div>
  );
}
