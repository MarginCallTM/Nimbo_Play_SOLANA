"use client";

import { useMemo } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { getReadonlyProgram } from "@/lib/anchor";
import { deriveLotteryPda } from "@/lib/pda";
import { CURRENT_ROUND_ID } from "@/lib/constants";

// Reads the Lottery account for a round. Read-only program: works for
// visitors with no wallet connected. Components calling this with the same
// roundId share ONE cache entry (and one RPC call) via the queryKey.
export function useLottery(roundId: number = CURRENT_ROUND_ID) {
    const { connection } = useConnection();

    // Both memos: stable references so useQuery doesn't see "new" inputs
    // on every render.
    const program = useMemo(() => getReadonlyProgram(connection), [connection]);
    const lotteryPda = useMemo(() => deriveLotteryPda(roundId), [roundId]);

    return useQuery({
        queryKey: ["lottery", roundId],
        // fetchNullable: resolves to null when the account doesn't exist
        // (round not initialized) instead of rejecting — "no round yet" is
        // a UI state, not an error.
        queryFn: () => program.account.lottery.fetchNullable(lotteryPda),
        // Poll every 30s: on-chain state moves without telling us. Cheap
        // enough for the public RPC; tx flows will invalidate manually (10.11).
        refetchInterval: 30_000,
    });
}
