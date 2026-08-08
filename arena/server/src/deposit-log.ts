// A4.6 money red-team (2026-08-07) — the anti-replay ledger for deposit
// signatures, made to SURVIVE A RESTART.
//
// The hole this closes. A deposit signature was single-use, but only in
// RAM: `consumedSigs` was a plain Set inside chain.ts. A restart forgot
// every one of them, and the only remaining guard was MAX_DEPOSIT_AGE_S
// — so any deposit tx from the preceding 10 minutes could be presented a
// SECOND time and buy a SECOND spawn. That is minting: the vault holds
// one stake, the arena hands out two snakes, and the [eco] ledger's
// `injected` grows with money that never arrived. Restarts are not rare
// in this project's own workflow (every code change is one), which is
// exactly the window an attacker with a fresh txSig in hand would use.
//
// Same append-only JSONL discipline as the settlement outbox: a crash
// mid-write costs at most the last line, and history is never rewritten
// in place. Entries older than the deposit age limit are dropped on
// load and on sweep — a signature that old is refused by the age check
// anyway, so remembering it buys nothing and the file stays bounded.
//
// Multi-process note (APROD.7): like the SIWS nonces and the arena
// registry, this assumes ONE server process. Sharding moves it to
// Postgres/Redis, where the same uniqueness constraint holds globally.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const DEPOSIT_LOG_FILE = process.env.DEPOSIT_LOG_FILE ?? "./consumed-deposits.jsonl";

// Must match chain.ts's MAX_DEPOSIT_AGE_S: this store only has to
// remember signatures for as long as they could still be accepted.
const RETENTION_MS = 10 * 60 * 1000;

interface Entry {
    sig: string;
    at: number; // unix ms of consumption
}

const consumed = new Map<string, number>(); // sig -> consumed-at

export function loadDepositLog(): void {
    if (!existsSync(DEPOSIT_LOG_FILE)) {
        console.log(`[deposits] ${DEPOSIT_LOG_FILE} — fresh (no file yet)`);
        return;
    }
    const cutoff = Date.now() - RETENTION_MS;
    let skipped = 0;
    let expired = 0;
    for (const raw of readFileSync(DEPOSIT_LOG_FILE, "utf8").split("\n")) {
        if (!raw.trim()) continue;
        let entry: Entry;
        try {
            entry = JSON.parse(raw);
        } catch {
            skipped++; // torn last line from a crash mid-write
            continue;
        }
        if (typeof entry?.sig !== "string" || typeof entry?.at !== "number") continue;
        if (entry.at <= cutoff) {
            expired++;
            continue;
        }
        consumed.set(entry.sig, entry.at);
    }
    // Compact on boot: the file is rewritten to exactly what we kept,
    // so a long-lived server does not accumulate dead signatures.
    if (expired > 0 || skipped > 0) rewrite();
    console.log(
        `[deposits] loaded — ${consumed.size} live signature(s)` +
        `${expired ? `, ${expired} expired dropped` : ""}` +
        `${skipped ? `, ${skipped} torn line(s) skipped` : ""}`,
    );
}

export function isConsumed(sig: string): boolean {
    const at = consumed.get(sig);
    if (at === undefined) return false;
    if (at <= Date.now() - RETENTION_MS) {
        // past the age limit the deposit is refused by chain.ts anyway;
        // treat it as gone so the map does not grow forever
        consumed.delete(sig);
        return false;
    }
    return true;
}

// Durable BEFORE the caller acts on it: a crash between "reserved" and
// "written" must not resurrect the signature. appendFileSync is
// deliberate — an async write could still be in flight when the process
// dies, and this is money.
export function consume(sig: string): void {
    const at = Date.now();
    consumed.set(sig, at);
    appendFileSync(DEPOSIT_LOG_FILE, JSON.stringify({ sig, at } satisfies Entry) + "\n");
    sweep();
}

// Release a signature reserved for a claim that turned out to be
// TRANSIENTLY broken (RPC down, tx not propagated yet): the player
// really did pay, so the same tx must still buy the retry. Permanent
// rejections never come through here — see chain.ts.
export function release(sig: string): void {
    if (!consumed.delete(sig)) return;
    rewrite(); // the file is the truth; a released sig must leave it
}

let lastSweep = 0;
function sweep(): void {
    const now = Date.now();
    if (now - lastSweep < 60_000) return; // at most once a minute
    lastSweep = now;
    const cutoff = now - RETENTION_MS;
    let dropped = 0;
    for (const [sig, at] of consumed) {
        if (at <= cutoff) {
            consumed.delete(sig);
            dropped++;
        }
    }
    if (dropped > 0) rewrite();
}

function rewrite(): void {
    const lines = [...consumed]
        .map(([sig, at]) => JSON.stringify({ sig, at } satisfies Entry))
        .join("\n");
    writeFileSync(DEPOSIT_LOG_FILE, lines ? lines + "\n" : "");
}
