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

export function loadOutbox(): void {
    if (!existsSync(OUTBOX_FILE)) {
        console.log(`[outbox] ${OUTBOX_FILE} — fresh (no file yet)`);
        return;
    }
    let skipped = 0;
    for (const raw of readFileSync(OUTBOX_FILE, "utf8").split("\n")) {
        if (!raw.trim()) continue;
        let line: Line;
        try {
            line = JSON.parse(raw);
        } catch {
            skipped++; // torn last line from a crash mid-write
            continue;
        }
        if (line.type === "claim") claims.set(line.nonce, line);
        else if (line.type === "ack") acked.add(line.nonce);
    }
    console.log(
        `[outbox] loaded — ${claims.size} claims, ${acked.size} acked,` +
        ` ${pendingClaims().length} pending${skipped ? `, ${skipped} torn line(s) skipped` : ""}`,
    );
}

export function recordClaim(claim: Claim): void {
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
