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
    decodeJoinStake,
    decodeRoundAccount,
    isJoinData,
    roundPda,
    scoreFromLamports,
    splitStake,
    type RoundInfoResponse,
} from "@nimbo/shared";

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const connection = new Connection(RPC_URL, "confirmed");

// A deposit older than this is refused even if unseen: the consumed-
// signature set below lives in memory, so a server restart forgets it —
// this window bounds how far back a replay could reach. (The real fix,
// persistence/indexer, is A3.4.)
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

// Deposit signatures already exchanged for a spawn. In-memory like the
// SIWS nonces: single process assumption, bounded by MAX_DEPOSIT_AGE_S.
const consumedSigs = new Set<string>();

// Called once at boot. No ROUND_ID env = free-only mode: the server
// runs, but paid joins are refused (dev convenience, never silent —
// it logs loudly).
export async function loadRound(): Promise<void> {
    const raw = process.env.ROUND_ID;
    if (!raw) {
        console.log("[chain] ROUND_ID not set — FREE-ONLY mode, paid joins refused");
        return;
    }
    const roundId = BigInt(raw);
    const pda = roundPda(roundId);
    const info = await connection.getAccountInfo(pda);
    if (info === null) {
        throw new Error(`[chain] round ${roundId} not found on ${RPC_URL} — run init-arena-devnet`);
    }
    const round = decodeRoundAccount(info.data);
    if (!round) throw new Error("[chain] account exists but is not a Round (wrong ROUND_ID?)");
    if (!round.isOpen) throw new Error(`[chain] round ${roundId} is already Ended`);
    // D74 — the pellet cut is OUR accounting on top of vault money; a
    // round that ALSO routes lamports to the reserve PDA would count
    // the same value twice (pellets backed by lamports the vault
    // doesn't hold). Refuse to boot rather than run insolvent.
    if (round.reserveBps !== 0) {
        throw new Error(
            `[chain] round ${roundId} has reserve_bps=${round.reserveBps} — ` +
            "D74 requires 0 (pellet cut is server-side); open a fresh round",
        );
    }
    const nowS = Math.floor(Date.now() / 1000);
    if (Number(round.endTimestamp) <= nowS) {
        throw new Error(`[chain] round ${roundId} deadline has passed — open a fresh one`);
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
}

// Verify a claimed deposit and convert it into spawn + pellet scores.
// Throws with a reason on ANY failure — the caller rejects the join.
export async function verifyDeposit(txSig: string, wallet: string): Promise<DepositResult> {
    if (!current) throw new Error("no active round (server is in free-only mode)");

    // Reserve the signature BEFORE the async RPC work: two concurrent
    // joins racing on the same sig must not both pass the membership
    // check while the first is still fetching. Released on failure.
    if (consumedSigs.has(txSig)) throw new Error("deposit already used");
    consumedSigs.add(txSig);
    try {
        const tx = await connection.getTransaction(txSig, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
        });
        if (!tx) throw new Error("deposit tx not found on chain");
        if (tx.meta?.err) throw new Error("deposit tx failed on-chain");
        if (!tx.blockTime || Date.now() / 1000 - tx.blockTime > MAX_DEPOSIT_AGE_S) {
            throw new Error("deposit tx too old");
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
                throw new Error("deposit went to a different round");
            }
            // THE binding check (why SIWS exists): the depositor must
            // be the wallet this session proved it owns. Signatures
            // are public — anyone can present anyone's txSig.
            if (player?.toBase58() !== wallet) {
                throw new Error("deposit was made by a different wallet");
            }

            // The truth about the amount comes from the TX BYTES, not
            // from anything the client claimed. The program succeeded,
            // so the split math below matches what actually moved.
            const stake = decodeJoinStake(data);
            const { pelletLamports, spawnLamports } = splitStake(stake, current.rakeBps);
            const result: DepositResult = {
                spawnScore: scoreFromLamports(spawnLamports),
                pelletScore: scoreFromLamports(pelletLamports),
            };
            console.log(
                `[chain] deposit ok: ${Number(stake) / 1e9} SOL by ${wallet.slice(0, 4)}..` +
                ` -> spawn ${result.spawnScore.toFixed(1)} + pellets ${result.pelletScore.toFixed(1)}`,
            );
            return result;
        }
        throw new Error("tx contains no arena join instruction");
    } catch (err) {
        consumedSigs.delete(txSig); // failed claims don't burn the sig
        throw err;
    }
}

// A failed join AFTER a successful verification must not burn the
// deposit (2026-08-03 flaw): releasing the signature lets the player
// retry with the same, already-paid tx.
export function releaseDeposit(txSig: string): void {
    consumedSigs.delete(txSig);
}
