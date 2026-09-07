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

// AF.2 — where Nimbo Arena lives. The game is a SEPARATE app (Vite +
// Colyseus) on its own subdomain, so every link to it is absolute.
// Env-driven so the same code serves local dev, the .dev testbed and
// later the .app production host without an edit.
// Baked at build time like every NEXT_PUBLIC_* — changing it needs a
// rebuild, not a restart.
export const ARENA_URL =
    process.env.NEXT_PUBLIC_ARENA_URL || "https://arena.nimboplay.dev";

// F8.7 - where the Mintlify docs live. Same shape as ARENA_URL (separate
// host, absolute link, baked at build time), with ONE deliberate
// difference: the fallback is an EMPTY STRING, not a URL.
//
// Empty means "the docs are not published yet", and every component that
// links to them renders NOTHING in that case. The alternative - defaulting
// to https://docs.nimboplay.dev - would ship a 404 on the day the site
// deploys, which is the exact debt F10.3 records against the old front
// (Documentation, Leaderboard, Terms and Privacy all pointing nowhere) and
// which faq.tsx already refused to add back once.
//
// Publishing the docs is therefore a ONE-LINE change on the VPS:
//   NEXT_PUBLIC_DOCS_URL=https://docs.nimboplay.dev
// followed by a rebuild of the `web` image (NEXT_PUBLIC_* are inlined at
// BUILD time - a restart will not pick this up).
export const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL || "";