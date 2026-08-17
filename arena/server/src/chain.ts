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

// AF.1 — the server knows SEVERAL rounds at once. A round is a sealed
// pot (its own Round PDA + Vault PDA), and rotation means N and N+1 are
// briefly alive together: N still hosting the rooms that started in it,
// N+1 taking every new deposit. This registry is that knowledge.
//
// THE INVARIANT this file exists to protect: a deposit belongs to the
// round its TRANSACTION targeted — never to "whatever round is current"
// read at some later moment. Rooms are pinned to a round and pay out of
// ITS vault only, so money never crosses a vault boundary and per-vault
// solvency (A2.9) survives rotation untouched.
export interface RoundRecord {
    roundId: bigint;
    pda: PublicKey;
    treasury: PublicKey;
    rakeBps: number;
    reserveBps: number;
    endTimestamp: bigint; // unix seconds, read from the chain
}

// Every round we still take money for or owe money from. Keyed by the
// round id AS A STRING: Map compares bigint keys by identity, so two
// equal bigints would be two different entries.
const rounds = new Map<string, RoundRecord>();
// Reverse index. verifyDeposit pulls a Round PDA out of a transaction
// and must answer "is that one of ours?" without scanning.
const byPda = new Map<string, RoundRecord>();
// The single round GET /round advertises: what every NEW deposit funds.
// Rounds we know but no longer advertise are DRAINING.
let openRoundId: string | undefined;

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
        // AF.1 — and owes it from THE VAULT THAT HOLDS IT. With several
        // rounds alive, refunding out of "the current round" would pay an
        // old debt with new depositors' money.
        readonly refundRoundId?: string,
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
    let roundId: bigint;
    try {
        roundId = BigInt(raw);
    } catch {
        console.warn(`[chain] ⚠️  PAID ARENA DISABLED — ROUND_ID "${raw}" is not a valid integer`);
        return;
    }
    const reason = await registerRound(roundId);
    if (reason) {
        console.warn(
            `[chain] ⚠️  PAID ARENA DISABLED — ${reason}.\n` +
            "[chain] ⚠️  Running FREE-ONLY. Open a fresh round to enable paid play.",
        );
        return;
    }
    // The configured round is the one new deposits fund, until the
    // rotation timer hands that role to its successor.
    setOpenRound(roundId);
}

// Validate a round on chain and add it to the registry WITHOUT throwing:
// returns undefined on success, or a human-readable reason on any
// failure — RPC blip, wrong/ended/expired round. Callers turn a reason
// into a free-only downgrade (boot) or a rotation retry (AF.1), never a
// crash. Idempotent: re-registering a known round just refreshes it.
export async function registerRound(roundId: bigint): Promise<string | undefined> {
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
        const record: RoundRecord = {
            roundId,
            pda,
            treasury: round.treasury,
            rakeBps: round.rakeBps,
            reserveBps: round.reserveBps,
            endTimestamp: round.endTimestamp,
        };
        rounds.set(roundId.toString(), record);
        byPda.set(pda.toBase58(), record);
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

// --- registry accessors (AF.1) ------------------------------------------

// The round new deposits fund. Undefined = free-only.
export function openRound(): RoundRecord | undefined {
    return openRoundId ? rounds.get(openRoundId) : undefined;
}

export function knownRound(roundId: string): RoundRecord | undefined {
    return rounds.get(roundId);
}

// Every round still on our books: the open one plus the draining ones.
export function knownRounds(): RoundRecord[] {
    return [...rounds.values()];
}

// Hand the "new deposits land here" role to a round. Registering must
// come FIRST — pointing at an unknown round would advertise a PDA we
// never validated.
export function setOpenRound(roundId: bigint): void {
    const key = roundId.toString();
    if (!rounds.has(key)) {
        console.error(`[chain] refusing to open unknown round ${key} — register it first`);
        return;
    }
    openRoundId = key;
    console.log(`[chain] round ${key} is now OPEN for new deposits`);
}

// Called once a round is ENDED on chain (its vault is swept and closed).
// Dropping it from the registry is what makes a late deposit into it
// impossible to honour here — the chain refuses it too (join requires
// now < end_timestamp), this is the second lock.
export function forgetRound(roundId: bigint): void {
    const key = roundId.toString();
    const record = rounds.get(key);
    if (!record) return;
    rounds.delete(key);
    byPda.delete(record.pda.toBase58());
    if (openRoundId === key) {
        // Should never happen: the manager only ends DRAINING rounds.
        console.error(`[chain] ⚠️  ended round ${key} was still the open one — now free-only`);
        openRoundId = undefined;
    }
}

// What GET /round serves the client (round_id as STRING: u64 does not
// fit in a JS number without silent precision loss). Always the OPEN
// round: this response is what the client's deposit tx is built from.
export function roundInfo(): RoundInfoResponse | undefined {
    const round = openRound();
    if (!round) return undefined;
    return {
        roundId: round.roundId.toString(),
        treasury: round.treasury.toBase58(),
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
    // AF.1 — WHICH round this money went into, read out of the tx's
    // Round account, not out of any client claim or global variable.
    // The room the player lands in must be pinned to this same round.
    roundId: string;
}

// Verify a claimed deposit and convert it into spawn + pellet scores.
// Throws with a reason on ANY failure — the caller rejects the join.
export async function verifyDeposit(txSig: string, wallet: string): Promise<DepositResult> {
    if (rounds.size === 0) {
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
            const roundKey = keys.get(ix.accountKeyIndexes[1]);
            // initialize_round is PERMISSIONLESS: a deposit into some
            // attacker-created round must buy nothing here. AF.1 widens
            // this from one round to the registry — but ONLY to rounds we
            // opened and have not ended. A round that left the registry
            // (swept) is as foreign as an attacker's.
            //
            // Deliberately NOT checked here: whether the round's deadline
            // has passed. The program already enforces `now <
            // end_timestamp` inside join, so a tx that CONFIRMED was
            // accepted by a live round. Re-testing it against OUR clock
            // would open a theft path — a server clock running ahead
            // would refuse a deposit the vault really holds.
            const record = roundKey && byPda.get(roundKey.toBase58());
            if (!record) {
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
                const { spawnLamports, pelletLamports } = splitStake(stake, record.rakeBps);
                throw new DepositRejected(
                    `stake ${stake} below the ${MIN_STAKE_LAMPORTS} lamport floor`,
                    false,
                    spawnLamports + pelletLamports, // everything but the on-chain rake
                    record.roundId.toString(), // the vault that owes the refund
                );
            }
            // The split uses THIS round's rake, read from ITS account: two
            // rounds alive at once may not share a rake setting.
            const { pelletLamports, spawnLamports } = splitStake(stake, record.rakeBps);
            const result: DepositResult = {
                spawnScore: scoreFromLamports(spawnLamports),
                pelletScore: scoreFromLamports(pelletLamports),
                stakeLamports: stake.toString(),
                roundId: record.roundId.toString(),
            };
            const draining = openRoundId !== result.roundId ? " (DRAINING round)" : "";
            console.log(
                `[chain] deposit ok: ${Number(stake) / 1e9} SOL by ${wallet.slice(0, 4)}..` +
                ` -> spawn ${result.spawnScore.toFixed(1)} + pellets ${result.pelletScore.toFixed(1)}` +
                ` in round ${result.roundId}${draining}`,
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
