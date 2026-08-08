// A3.2 — the on-chain vocabulary of the arena program, shared by the
// browser client (builds the join tx), the game server (verifies the
// deposit) and the loadtest bots (replay the same protocol headless).
//
// Encoded BY HAND on purpose: no Anchor client in the browser (heavy,
// Node-polyfill hell under Vite). An Anchor instruction is just bytes:
//   [8-byte discriminator = sha256("global:<name>")[0..8]] ++ borsh(args)
// and an account is:
//   [8-byte discriminator = sha256("account:<Name>")[0..8]] ++ borsh(fields)
// The values below are copied from target/idl/arena.json — the IDL is
// the source of truth; re-check after ANY change to the program.

import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

// Fixed at first build by declare_id! — never changes across deploys.
export const ARENA_PROGRAM_ID = new PublicKey(
    "8qGdXYu3prvvvhCEfMnatdv5BAQyVL5NWsh7v5esEF2d"
);

// PDA seeds — byte-exact mirrors of the Rust constants.
const ROUND_SEED = "round";
const VAULT_SEED = "vault";
const RESERVE_SEED = "food_reserve";

// From the IDL (instructions[join].discriminator / accounts[Round]).
const JOIN_IX_DISCRIMINATOR = new Uint8Array([206, 55, 2, 106, 113, 220, 17, 163]);
const ROUND_ACC_DISCRIMINATOR = new Uint8Array([87, 127, 165, 51, 73, 78, 116, 174]);

// --- little-endian u64 helpers (browser-safe: no Buffer) ---------------

function u64Le(value: bigint): Uint8Array {
    const out = new Uint8Array(8);
    new DataView(out.buffer).setBigUint64(0, value, true);
    return out;
}

// --- PDA derivation (mirror of round_id.to_le_bytes() seeds) -----------

export function roundPda(roundId: bigint): PublicKey {
    return PublicKey.findProgramAddressSync(
        [new TextEncoder().encode(ROUND_SEED), u64Le(roundId)],
        ARENA_PROGRAM_ID
    )[0];
}

export function vaultPda(roundId: bigint): PublicKey {
    return PublicKey.findProgramAddressSync(
        [new TextEncoder().encode(VAULT_SEED), u64Le(roundId)],
        ARENA_PROGRAM_ID
    )[0];
}

export function reservePda(): PublicKey {
    return PublicKey.findProgramAddressSync(
        [new TextEncoder().encode(RESERVE_SEED)],
        ARENA_PROGRAM_ID
    )[0];
}

// --- join instruction ----------------------------------------------------

// data = discriminator ++ stake:u64le  (join's only arg; the round is
// identified by the Round account itself, its seeds lock the id)
export function encodeJoinData(stakeLamports: bigint): Uint8Array {
    const data = new Uint8Array(16);
    data.set(JOIN_IX_DISCRIMINATOR, 0);
    data.set(u64Le(stakeLamports), 8);
    return data;
}

// 16 bytes, not 8: the discriminator ALONE is not a join — decodeJoinStake
// reads 8 more, and a DataView past the end throws RangeError instead of
// returning a rejection. Any caller that trusts this predicate then decodes.
export function isJoinData(data: Uint8Array): boolean {
    if (data.length < 16) return false;
    return JOIN_IX_DISCRIMINATOR.every((b, i) => data[i] === b);
}

export function decodeJoinStake(data: Uint8Array): bigint {
    // borsh args start right after the 8-byte discriminator
    return new DataView(data.buffer, data.byteOffset + 8, 8).getBigUint64(0, true);
}

// Account order is the CONTRACT (IDL order) — swap two writable
// accounts and the transfer pays the wrong party or fails on seeds.
export function buildJoinInstruction(opts: {
    player: PublicKey;
    roundId: bigint;
    treasury: PublicKey; // must match round.treasury (has_one)
    stakeLamports: bigint;
}): TransactionInstruction {
    return new TransactionInstruction({
        programId: ARENA_PROGRAM_ID,
        keys: [
            { pubkey: opts.player, isSigner: true, isWritable: true },
            { pubkey: roundPda(opts.roundId), isSigner: false, isWritable: true },
            { pubkey: vaultPda(opts.roundId), isSigner: false, isWritable: true },
            { pubkey: opts.treasury, isSigner: false, isWritable: true },
            { pubkey: reservePda(), isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: encodeJoinData(opts.stakeLamports) as unknown as Buffer,
    });
}

// --- Round account decoding ---------------------------------------------

// Borsh layout after the 8-byte discriminator, offsets from the Rust
// struct (LEN = 127, proven by A2.2 tests):
//   round_id u64 | authority 32 | treasury 32 | rake_bps u16 |
//   reserve_bps u16 | end_timestamp i64 | state u8 (0=Open, 1=Ended) |
//   total_staked u64 | total_deposited u64 | total_injected u64 |
//   total_paid u64 | round_bump u8 | vault_bump u8
export interface RoundAccount {
    roundId: bigint;
    authority: PublicKey;
    treasury: PublicKey;
    rakeBps: number;
    reserveBps: number;
    endTimestamp: bigint;
    isOpen: boolean;
    totalStaked: bigint;
    totalDeposited: bigint;
    totalInjected: bigint;
    totalPaid: bigint;
}

export function decodeRoundAccount(data: Uint8Array): RoundAccount | undefined {
    if (data.length < 127) return undefined;
    if (!ROUND_ACC_DISCRIMINATOR.every((b, i) => data[i] === b)) return undefined;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return {
        roundId: view.getBigUint64(8, true),
        authority: new PublicKey(data.subarray(16, 48)),
        treasury: new PublicKey(data.subarray(48, 80)),
        rakeBps: view.getUint16(80, true),
        reserveBps: view.getUint16(82, true),
        endTimestamp: view.getBigInt64(84, true),
        isOpen: data[92] === 0,
        totalStaked: view.getBigUint64(93, true),
        totalDeposited: view.getBigUint64(101, true),
        totalInjected: view.getBigUint64(109, true),
        totalPaid: view.getBigUint64(117, true),
    };
}

// --- economy mirror -------------------------------------------------

// EXACT mirror of the on-chain split (join instruction): rake and
// reserve are floor divisions, the spawn value is what REMAINS — the
// three parts sum to the stake to the lamport (division dust goes to
// the player, proven by the A2.8 tests). rake_bps/reserve_bps come
// from the Round account, never from constants that could drift.
export function spawnValueFromStake(
    stakeLamports: bigint,
    rakeBps: number,
    reserveBps: number,
): bigint {
    const rake = (stakeLamports * BigInt(rakeBps)) / 10_000n;
    const reserve = (stakeLamports * BigInt(reserveBps)) / 10_000n;
    return stakeLamports - rake - reserve;
}

// THE tuning knob (TODO: "taux SOL<->score", half-decided 2026-07-23):
// settlement always runs on SCORE at this fixed rate — SOL -> score at
// join, score -> SOL at extraction, same rate both ways (strict
// conservation). Size = f(score) stays pure display. 1000 puts the
// 0.1 SOL tier (~92.5 net score) right in the proto's 20-80 spawn
// range; retune freely at playtest, BUT only between rounds — changing
// it mid-round would rewrite what players' scores are worth.
export const SCORE_PER_SOL = 1000;

export function scoreFromLamports(lamports: bigint): number {
    // score is a float32 gameplay value: precision loss here is fine
    // (the CHAIN keeps the exact lamports; score is the game's ledger)
    return (Number(lamports) / 1_000_000_000) * SCORE_PER_SOL;
}

// Exit side of the ledger: score -> lamports at the SAME rate as the
// entry (strict conservation). Rounded DOWN: the sub-lamport dust
// stays in the vault (swept to the FoodReserve at end_round, D50) —
// the house never owes more than the ledger says.
export function lamportsFromScore(score: number): bigint {
    return BigInt(Math.floor((score / SCORE_PER_SOL) * 1_000_000_000));
}

// D74/D75 — the pellet cut is SERVER accounting: on-chain the round
// runs with reserve_bps = 0 so every non-rake lamport sits in the
// Vault (extractions can always be paid, D55). The tuning knob:
export const PELLET_CUT_BPS = 1000; // 10% of the stake becomes pellets (D75)

// A4.6 money red-team (2026-08-07) — THE ENTRY FLOOR, server-enforced.
// The program only requires stake > 0, and score 0 maps to the SMALLEST
// and FASTEST-TURNING snake in the game (describeSnakeFromScore: radius
// and turn speed are both best at score 0). A 1-lamport join therefore
// buys a perfect kamikaze for a transaction fee: it trades head-on with
// a 1 SOL whale — the dominant meta, measured at 16/20 deaths in the
// 2026-08-06 run — and pays a rake of zero doing it. The menu's tier
// buttons are NOT a gate: options.stake is display-only and the bots
// prove a headless client can name any amount it likes.
export const MIN_STAKE_LAMPORTS = 100_000_000n; // 0.1 SOL = lowest menu tier

// Refunding costs the house an ExtractReceipt rent (~0.0014 SOL) plus a
// transaction fee. Below this, a refund returns less than it costs to
// send — and an attacker spamming dust deposits purely to force refunds
// would drain the authority wallet one receipt rent at a time. Dust
// under the floor is kept and documented rather than paid back.
export const MIN_REFUNDABLE_LAMPORTS = 2_000_000n; // ~0.002 SOL

// The full entry split. rakeBps comes from the Round account; the
// pellet cut is ours. Floor divisions, spawn takes the dust — the
// three parts sum to the stake exactly.
export function splitStake(
    stakeLamports: bigint,
    rakeBps: number,
): { pelletLamports: bigint; spawnLamports: bigint } {
    const rake = (stakeLamports * BigInt(rakeBps)) / 10_000n;
    const pelletLamports = (stakeLamports * BigInt(PELLET_CUT_BPS)) / 10_000n;
    return { pelletLamports, spawnLamports: stakeLamports - rake - pelletLamports };
}
