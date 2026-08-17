// A3.3 — the settlement outbox: every extraction is a DEBT to a
// player, so it must survive a server crash. Append-only JSONL file:
// a "claim" line when a snake cashes out, an "ack" line when the
// settlement service confirms the on-chain payout. Pending = claims
// without acks, rebuilt from the file at boot.
//
// Why append-only: a crash mid-write corrupts at most the last line
// (detected and skipped at load); previous history is untouchable.
// Postgres takes over with the indexer (A3.4).
//
// Idempotence note: losing an ack is harmless — the service will
// re-submit, and the on-chain ExtractReceipt PDA (anti-replay, A2.5)
// rejects the duplicate. The CHAIN guarantees paid-once, not us.

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import bs58 from "bs58";

const OUTBOX_FILE = process.env.OUTBOX_FILE ?? "./settlement-outbox.jsonl";

export interface Claim {
    wallet: string;   // base58 — the payout destination
    lamports: string; // amount owed (u64 as string)
    nonce: string;    // on-chain anti-replay key (u64 as string)
    // The round whose vault OWES this claim (u64 as string). Rounds
    // are sealed pots: settling a claim against another round's vault
    // would pay old debts with new depositors' money (2026-08-04 gap,
    // caught before it ever paid out).
    roundId: string;
    at: number;       // unix ms, diagnostic only
}

type Line =
    | ({ type: "claim" } & Claim)
    | { type: "ack"; nonce: string; txSig: string; at: number };

const claims = new Map<string, Claim>(); // nonce -> claim
const acked = new Set<string>();         // nonces already settled

// A4.6 money red-team (2026-08-07) — THE nonce allocator, process-wide.
//
// The hole this closes. Each ArenaRoom carried its own counter, seeded
// `BigInt(Date.now()) * 1000n`. The comment claimed uniqueness "even
// across restarts", and across restarts it held — but the seed is per
// ROOM INSTANCE, and two rooms created in the same millisecond (the
// lobby pairs cohorts, joinOrCreate races) get IDENTICAL sequences.
// The consequence is silent and one-directional: (round_id, nonce) is
// the ExtractReceipt PDA seed, so the second player's payout is refused
// on-chain forever as a replay, the settlement service reads the
// receipt, concludes "already settled", and ACKS a claim it never paid.
// A real player's extraction disappears with a success message.
//
// The fix is to stop deriving uniqueness from a clock read. One counter
// for the whole process, seeded above every nonce this outbox has ever
// recorded — the outbox IS the durable record, so a restart resumes
// past its own history instead of trusting that time moved forward
// (it does not always: NTP corrections step backwards).
let nonceCursor = 0n;

export function loadOutbox(): void {
    // Floor: a clean install with no history still starts somewhere
    // sane and monotonic across boots.
    nonceCursor = BigInt(Date.now()) * 1000n;
    if (!existsSync(OUTBOX_FILE)) {
        console.log(`[outbox] ${OUTBOX_FILE} — fresh (no file yet)`);
        return;
    }
    let skipped = 0;
    let poisoned = 0;
    for (const raw of readFileSync(OUTBOX_FILE, "utf8").split("\n")) {
        if (!raw.trim()) continue;
        let line: Line;
        try {
            line = JSON.parse(raw);
        } catch {
            skipped++; // torn last line from a crash mid-write
            continue;
        }
        if (line.type === "claim") {
            // Self-healing: a poison row already ON DISK (unpayable
            // wallet, bogus roundId) is skipped on load, not just
            // refused on write. Without this, the five `wallet:"demo"`
            // rows written before the recordClaim guard existed would
            // keep re-entering pendingClaims and jamming the settlement
            // loop on every restart. It still counts toward the cursor
            // below — the nonce was spent, even on an unpayable claim.
            if (isPayableClaim(line)) claims.set(line.nonce, line);
            else poisoned++;
        } else if (line.type === "ack") {
            acked.add(line.nonce);
        }
        // Every nonce ever written moves the cursor, acked or not: a
        // settled receipt occupies its PDA permanently.
        const seen = parseNonce(line.nonce);
        if (seen !== undefined && seen >= nonceCursor) nonceCursor = seen + 1n;
    }
    console.log(
        `[outbox] loaded — ${claims.size} claims, ${acked.size} acked,` +
        ` ${pendingClaims().length} pending${skipped ? `, ${skipped} torn line(s) skipped` : ""}` +
        `${poisoned ? `, ${poisoned} unpayable row(s) ignored` : ""}` +
        ` — next nonce ${nonceCursor}`,
    );
}

function parseNonce(raw: string): bigint | undefined {
    // Historical rows include non-numeric nonces (the demo used the
    // literal "demo"); they never occupied a PDA, so they are skipped.
    if (!/^\d+$/.test(raw)) return undefined;
    try {
        return BigInt(raw);
    } catch {
        return undefined;
    }
}

// The ONLY source of settlement nonces. Rooms must never mint their own.
export function nextNonce(): bigint {
    return nonceCursor++;
}

// A claim is a promise to move real lamports to a real address. The
// settlement service parses `wallet` with Pubkey::from_str and a
// failure there is not a skip — it retries the same unpayable row every
// poll, forever (measured 2026-08-07: five `wallet:"demo"` rows from the
// demo room had been poisoning the loop since 2026-08-05). Refusing the
// row at the boundary keeps the debt ledger payable by construction.
function isPayableAddress(wallet: string): boolean {
    try {
        return bs58.decode(wallet).length === 32;
    } catch {
        return false;
    }
}

// A roundId picks WHICH vault pays. A bogus one ("0", non-numeric)
// settles against another round's pot — old debts paid with new
// depositors' money, the exact gap caught on 2026-08-04.
function isPayableRoundId(roundId: string): boolean {
    return /^\d+$/.test(roundId) && roundId !== "0";
}

// The single definition of "a debt we can actually pay". Used both at
// the write boundary (recordClaim, loud refusal) and at load
// (loadOutbox, silent skip of history already on disk).
function isPayableClaim(claim: Claim): boolean {
    return isPayableAddress(claim.wallet) && isPayableRoundId(claim.roundId);
}

export function recordClaim(claim: Claim): void {
    if (!isPayableAddress(claim.wallet)) {
        // Loud, and NOT written: a debt nobody can be paid is not a debt,
        // it is a stuck settlement loop.
        console.error(
            `[outbox] REFUSED claim to unpayable address "${claim.wallet}"` +
            ` (${claim.lamports} lamports, nonce ${claim.nonce}) — dropped, not written`,
        );
        return;
    }
    if (!isPayableRoundId(claim.roundId)) {
        console.error(
            `[outbox] REFUSED claim with roundId "${claim.roundId}"` +
            ` (${claim.lamports} lamports to ${claim.wallet}) — dropped, not written`,
        );
        return;
    }
    claims.set(claim.nonce, claim);
    appendFileSync(OUTBOX_FILE, JSON.stringify({ type: "claim", ...claim }) + "\n");
}

export function ackClaim(nonce: string, txSig: string): boolean {
    if (!claims.has(nonce)) return false; // unknown claim: refuse
    if (acked.has(nonce)) return true;    // duplicate ack: harmless
    acked.add(nonce);
    appendFileSync(
        OUTBOX_FILE,
        JSON.stringify({ type: "ack", nonce, txSig, at: Date.now() } satisfies Line) + "\n",
    );
    return true;
}

export function pendingClaims(): Claim[] {
    const out: Claim[] = [];
    for (const [nonce, claim] of claims) {
        if (!acked.has(nonce)) out.push(claim);
    }
    return out;
}

// AF.1 — how many debts this round's vault still owes. end_round SWEEPS
// the vault into the FoodReserve and flips the state, which makes every
// later settle_extraction fail: closing a round with an unsettled claim
// would destroy a player's payout with no way to appeal. This count
// reaching zero is half the condition for ending a round (the other
// half is "no rooms left playing it").
export function unackedClaimCount(roundId: string): number {
    let count = 0;
    for (const [nonce, claim] of claims) {
        if (claim.roundId === roundId && !acked.has(nonce)) count += 1;
    }
    return count;
}
