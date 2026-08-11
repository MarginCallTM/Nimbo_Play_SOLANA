// A3.2 — the server's eye on the chain: load the current round at
// boot, and verify join deposits before anyone spawns with value.
//
// Trust model reminder: the txSig a client presents is a CLAIM. Every
// signature on Solana is PUBLIC (anyone can read anyone's tx in the
// explorer), so possession of a signature proves nothing — the checks
// below are what turn it into a proof of deposit BY THIS WALLET INTO
// OUR ROUND. The SIWS-authenticated wallet (A3.1) is the anchor.

import { Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import {
    ARENA_PROGRAM_ID,
    MIN_STAKE_LAMPORTS,
    decodeJoinStake,
    decodeRoundAccount,
    isJoinData,
    roundPda,
    scoreFromLamports,
    splitStake,
    type RoundInfoResponse,
} from "@nimbo/shared";
import { consume, isConsumed, release } from "./deposit-log";

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const connection = new Connection(RPC_URL, "confirmed");

// A deposit older than this is refused even if unseen. It used to be
// the ONLY backstop behind an in-memory Set (a restart forgot every
// consumed signature, so anything from the last 10 minutes replayed for
// a free second spawn). deposit-log.ts now persists the set, and this
// window is what lets that file stay bounded rather than what stops the
// replay. Keep the two RETENTION values in step.
const MAX_DEPOSIT_AGE_S = 10 * 60;

interface CurrentRound {
    roundId: bigint;
    pda: PublicKey;
    treasury: PublicKey;
    rakeBps: number;
    reserveBps: number;
    endTimestamp: bigint;
}
let current: CurrentRound | undefined;

// A rejected deposit is one of two very different things, and treating
// them alike was itself a flaw.
//   TRANSIENT — the tx is real and the player paid, we just could not
//     see it yet (RPC down, not propagated). The signature MUST be
//     released so the same, already-paid tx buys the retry.
//   PERMANENT — the tx will never be acceptable (wrong round, wrong
//     wallet, below the entry floor, too old, not a join at all).
//     Releasing it lets an attacker hammer the door with the same
//     material forever, and — once under-minimum deposits are refunded
//     — lets the same dust tx mint a refund claim on every retry.
// The default is PERMANENT: a new rejection reason must opt IN to being
// retryable, never inherit it by accident.
export class DepositRejected extends Error {
    constructor(
        message: string,
        readonly transient = false,
        // Set when the deposit was valid in every respect EXCEPT that it
        // sat below the entry floor — the caller owes this player their
        // money back (D80 rails), and owes it exactly once.
        readonly refundableLamports?: bigint,
    ) {
        super(message);
        this.name = "DepositRejected";
    }
}

// Called once at boot. No ROUND_ID env = free-only mode: the server
// runs, but paid joins are refused (dev convenience, never silent —
// it logs loudly).
export async function loadRound(): Promise<void> {
    const raw = process.env.ROUND_ID;
    if (!raw) {
        console.log("[chain] ROUND_ID not set — FREE-ONLY mode, paid joins refused");
        return;
    }
    // A4.10 (amends A3.2) — a SET-but-invalid round no longer kills the
    // process. It disables the PAID arena (free-only) with a loud
    // warning, so FREE play never depends on a healthy paid round.
    //
    // The money-safety invariant is intact: with no `current` round,
    // roundInfo() stays undefined, GET /round returns 503, and every
    // deposit is refused (resolveJoinPayment). What changed vs A3.2's
    // "kill the boot": a misconfigured PAID deployment now fails
    // loud-but-alive (nobody can pay, the log screams) instead of dead.
    // No money is ever mishandled either way.
    const reason = await loadPaidRound(raw);
    if (reason) {
        console.warn(
            `[chain] ⚠️  PAID ARENA DISABLED — ${reason}.\n` +
            "[chain] ⚠️  Running FREE-ONLY. Open a fresh round to enable paid play.",
        );
    }
}

// Validate the configured round WITHOUT throwing: returns undefined on
// success (and sets `current`), or a human-readable reason string on any
// failure — parse error, RPC blip, wrong/ended/expired round. The caller
// turns a reason into a free-only downgrade, never a crash.
async function loadPaidRound(raw: string): Promise<string | undefined> {
    let roundId: bigint;
    try {
        roundId = BigInt(raw);
    } catch {
        return `ROUND_ID "${raw}" is not a valid integer`;
    }
    try {
        const pda = roundPda(roundId);
        const info = await connection.getAccountInfo(pda);
        if (info === null) {
            return `round ${roundId} not found on ${RPC_URL} — run init-arena-devnet`;
        }
        const round = decodeRoundAccount(info.data);
        if (!round) return `account for round ${roundId} is not a Round (wrong ROUND_ID?)`;
        if (!round.isOpen) return `round ${roundId} is already Ended`;
        // D74 — the pellet cut is OUR accounting on top of vault money; a
        // round that ALSO routes lamports to the reserve PDA would count
        // the same value twice (pellets backed by lamports the vault
        // doesn't hold). Disable paid rather than run insolvent.
        if (round.reserveBps !== 0) {
            return `round ${roundId} has reserve_bps=${round.reserveBps} — D74 requires 0 (pellet cut is server-side)`;
        }
        const nowS = Math.floor(Date.now() / 1000);
        if (Number(round.endTimestamp) <= nowS) {
            return `round ${roundId} deadline has passed`;
        }
        current = {
            roundId,
            pda,
            treasury: round.treasury,
            rakeBps: round.rakeBps,
            reserveBps: round.reserveBps,
            endTimestamp: round.endTimestamp,
        };
        console.log(
            `[chain] round ${roundId} loaded — rake ${round.rakeBps}bps,` +
            ` reserve ${round.reserveBps}bps, ends ${new Date(Number(round.endTimestamp) * 1000).toISOString()}`,
        );
        return undefined;
    } catch (err) {
        // RPC/network failure at boot: disable paid, keep FREE alive.
        return `could not verify round ${roundId} (${(err as Error).message})`;
    }
}

// What GET /round serves the client (round_id as STRING: u64 does not
// fit in a JS number without silent precision loss).
export function roundInfo(): RoundInfoResponse | undefined {
    if (!current) return undefined;
    return {
        roundId: current.roundId.toString(),
        treasury: current.treasury.toBase58(),
    };
}

// What a verified deposit buys, in game units: the snake's starting
// score AND the pellets materialized on the map at join (D73/D75).
export interface DepositResult {
    spawnScore: number;
    pelletScore: number;
    // raw stake from the tx bytes, in lamports (string: u64-safe) —
    // the join feed announces the gross buy-in, not the net spawn value
    stakeLamports: string;
}

// Verify a claimed deposit and convert it into spawn + pellet scores.
// Throws with a reason on ANY failure — the caller rejects the join.
export async function verifyDeposit(txSig: string, wallet: string): Promise<DepositResult> {
    if (!current) {
        throw new DepositRejected("no active round (server is in free-only mode)");
    }
    // Signature shape is checked before anything touches the RPC or the
    // durable log: an oversized or non-base58 string is a probe, and it
    // must not get to write a line to disk.
    if (typeof txSig !== "string" || txSig.length < 64 || txSig.length > 96) {
        throw new DepositRejected("malformed signature");
    }

    // Reserve the signature BEFORE the async RPC work: two concurrent
    // joins racing on the same sig must not both pass the membership
    // check while the first is still fetching. Durable since 2026-08-07
    // (deposit-log.ts) — a restart used to forget this and re-open every
    // recent deposit for a free second spawn.
    if (isConsumed(txSig)) throw new DepositRejected("deposit already used");
    consume(txSig);
    try {
        const tx = await connection.getTransaction(txSig, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
        });
        // Not found is the one genuinely ambiguous answer: the tx may
        // simply not have propagated to this RPC node yet.
        if (!tx) throw new DepositRejected("deposit tx not found on chain", true);
        if (tx.meta?.err) throw new DepositRejected("deposit tx failed on-chain");
        if (!tx.blockTime || Date.now() / 1000 - tx.blockTime > MAX_DEPOSIT_AGE_S) {
            throw new DepositRejected("deposit tx too old");
        }

        // Walk the instructions looking for OUR program's join. The
        // message may be legacy or v0; web3.js normalizes both behind
        // getAccountKeys()/compiledInstructions.
        const msg = tx.transaction.message;
        const keys = msg.getAccountKeys();
        for (const ix of msg.compiledInstructions) {
            const programId = keys.get(ix.programIdIndex);
            if (!programId?.equals(ARENA_PROGRAM_ID)) continue;
            const data = typeof ix.data === "string" ? bs58.decode(ix.data) : ix.data;
            if (!isJoinData(data)) continue;

            // account order is the IDL contract: [player, round, ...]
            const player = keys.get(ix.accountKeyIndexes[0]);
            const round = keys.get(ix.accountKeyIndexes[1]);
            // initialize_round is PERMISSIONLESS: a deposit into some
            // attacker-created round must buy nothing here.
            if (!round?.equals(current.pda)) {
                throw new DepositRejected("deposit went to a different round");
            }
            // THE binding check (why SIWS exists): the depositor must
            // be the wallet this session proved it owns. Signatures
            // are public — anyone can present anyone's txSig.
            if (player?.toBase58() !== wallet) {
                throw new DepositRejected("deposit was made by a different wallet");
            }

            // The truth about the amount comes from the TX BYTES, not
            // from anything the client claimed. The program succeeded,
            // so the split math below matches what actually moved.
            const stake = decodeJoinStake(data);
            // A4.6 (2026-08-07) — the entry floor. The program accepts
            // any stake > 0, and score 0 is the smallest, fastest-turning
            // snake there is: a 1-lamport join is a free kamikaze against
            // a whale. The deposit is real, so this rejection OWES the
            // player a refund; the caller pays it on the D80 rails, once,
            // guaranteed by the signature staying permanently consumed.
            if (stake < MIN_STAKE_LAMPORTS) {
                const { spawnLamports, pelletLamports } = splitStake(stake, current.rakeBps);
                throw new DepositRejected(
                    `stake ${stake} below the ${MIN_STAKE_LAMPORTS} lamport floor`,
                    false,
                    spawnLamports + pelletLamports, // everything but the on-chain rake
                );
            }
            const { pelletLamports, spawnLamports } = splitStake(stake, current.rakeBps);
            const result: DepositResult = {
                spawnScore: scoreFromLamports(spawnLamports),
                pelletScore: scoreFromLamports(pelletLamports),
                stakeLamports: stake.toString(),
            };
            console.log(
                `[chain] deposit ok: ${Number(stake) / 1e9} SOL by ${wallet.slice(0, 4)}..` +
                ` -> spawn ${result.spawnScore.toFixed(1)} + pellets ${result.pelletScore.toFixed(1)}`,
            );
            return result;
        }
        throw new DepositRejected("tx contains no arena join instruction");
    } catch (err) {
        // Only a TRANSIENT failure gives the signature back. Anything
        // else — wrong round, wrong wallet, under the floor, not a join
        // — is final, and releasing it would hand an attacker unlimited
        // retries with the same material (and, for under-floor dust, a
        // fresh refund claim on every attempt).
        const rejection = err instanceof DepositRejected ? err : undefined;
        if (!rejection || rejection.transient) release(txSig);
        // An unexpected error (RPC threw something we don't model) is
        // treated as transient by the line above — the player paid, and
        // our plumbing failing is not their fault.
        throw rejection ?? new DepositRejected((err as Error).message, true);
    }
}

// A failed join AFTER a successful verification must not burn the
// deposit (2026-08-03 flaw): releasing the signature lets the player
// retry with the same, already-paid tx.
export function releaseDeposit(txSig: string): void {
    release(txSig);
}
