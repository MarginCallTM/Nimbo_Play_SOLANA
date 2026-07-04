import { PublicKey } from "@solana/web3.js";

// Central network identiry of the front. Values come from .env.local
// (NEXT_PUBLIC_* only - these are inlined into the client bundle at build
// time, so they must never contain secrets; a program id and an RPC URL
// are public by nature).

// new PublicKey(...) validates the base58 string at module load: a typo in
// the env fails fast at startup instead of producing wrong PDAs later.
export const PROGRAM_ID = new PublicKey(
    process.env.NEXT_PUBLIC_PROGRAM_ID ??
    "DD5CPAQWUtKSBajtNT9w4QbJysQnuWeDZ6yCdXKAYwro"
);

export const RPC_ENDPOINT = 
    process.env.NEXT_PUBLIC_RPC_ENDPOINT ?? "https://api.devnet.solana.com";

// The round the UI points at. MVP = one round at a time; bumped manually
// (env) when the authority opens a new round. Kept as a plain number here,
// converted to u64 little-endian bytes at PDA-derivation time (10.8).
export const CURRENT_ROUND_ID = Number(
    process.env.NEXT_PUBLIC_ROUND_ID ?? "1",
);