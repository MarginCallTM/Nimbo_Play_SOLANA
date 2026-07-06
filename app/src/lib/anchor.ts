import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Connection } from "@solana/web3.js";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import idl from "./idl/lottery.json";
import type { Lottery } from "./idl/lottery-types";
import { PROGRAM_ID } from "./constants";

// The IDL embeds the deploy address (Anchor 0.30+). If it ever diverges from
// the env-provided PROGRAM_ID (e.g. redeploy without re-copying the IDL),
// every PDA the client derives would be wrong - fail fast at module load
// instead of debugging silent "account not found" errors later.
if (idl.address !== PROGRAM_ID.toBase58()) {
    throw new Error(
        `IDL address (${idl.address}) != PROGRAM_ID (${PROGRAM_ID.toBase58()}).` +
        "Re-copy target/idl/lottery.json or fix NEXT_PUBLIC_PROGRAM_ID.",
    );
}

// Read-only client: enough to fetch and deserialize accounts (pot, tickets,
// countdown) without any wallet - visitors see live data before connecting.
export function getReadonlyProgram(connection: Connection): Program<Lottery> {
    return new Program(idl as Lottery, { connection });
}

// Full client: Wraps the user's wallet in an AnchorProvider so .rpc() calls
// can sign and pay. `wallet` comes from useAnchorWallet() (10.11).
// "confirmed" = the cluster voted on the tx; good UX/safety balance on devnet
export function GetProgram(
    connection: Connection,
    wallet: AnchorWallet,
): Program<Lottery> {
    const provider = new AnchorProvider(connection, wallet, {
        commitment: "confirmed",
    });
    return new Program(idl as Lottery, provider);
}