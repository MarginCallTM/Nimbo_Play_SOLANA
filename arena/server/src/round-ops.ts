// AF.1 — the round-operations queue: how the game server asks for a
// round to be OPENED or ENDED on chain without ever touching the
// authority key.
//
// WHY A QUEUE AND NOT AN RPC CALL. The settlement service holds the
// authority keypair. It is a PULL worker by design: it polls the game
// server, the game server never reaches into it. Giving it an inbound
// HTTP port so we could say "open a round now" would add a network
// surface to the one process that can move money — for zero benefit,
// since rotation happens with minutes of margin and has no need to be
// synchronous. So round operations ride the same rails as extraction
// debts: an append-only file here, a poll + ack there.
//
// Same crash-safety story as the outbox, and the same source of truth:
// the CHAIN. An op is a request, never a record of what happened —
// initialize_round on an existing PDA fails, end_round on an ended
// round fails, and both failures mean "already done". That is why the
// round id must be DETERMINISTIC (see round-manager.ts): a retry has to
// re-derive the same PDA, or it would open a SECOND round instead of
// discovering the first.

import { appendFileSync, existsSync, readFileSync } from "node:fs";

const ROUND_OPS_FILE = process.env.ROUND_OPS_FILE ?? "./round-ops.jsonl";

export type RoundOpKind = "open" | "end";

export interface RoundOp {
    kind: RoundOpKind;
    roundId: string; // u64 as decimal string
    // "open" only: the on-chain deadline to set, unix seconds as string.
    // After it passes, the program itself refuses new joins — that is
    // what turns a round from OPEN into DRAINING, with no help from us.
    endTimestamp?: string;
    at: number; // unix ms, diagnostic only
}

type Line =
    | ({ type: "op" } & RoundOp)
    | { type: "ack"; key: string; txSig: string; at: number };

// An operation is unique per (kind, round): you open a round once and
// end it once. This key is also what the settlement service acks with.
export function opKey(kind: RoundOpKind, roundId: string): string {
    return `${kind}:${roundId}`;
}

const ops = new Map<string, RoundOp>();
const acked = new Set<string>();

export function loadRoundOps(): void {
    if (!existsSync(ROUND_OPS_FILE)) {
        console.log(`[rounds] ${ROUND_OPS_FILE} — fresh (no file yet)`);
        return;
    }
    let skipped = 0;
    for (const raw of readFileSync(ROUND_OPS_FILE, "utf8").split("\n")) {
        if (!raw.trim()) continue;
        let line: Line;
        try {
            line = JSON.parse(raw);
        } catch {
            skipped++; // torn last line from a crash mid-write
            continue;
        }
        if (line.type === "op") {
            if (isValidOp(line)) ops.set(opKey(line.kind, line.roundId), line);
            else skipped++;
        } else if (line.type === "ack") {
            acked.add(line.key);
        }
    }
    console.log(
        `[rounds] loaded — ${ops.size} op(s), ${acked.size} acked,` +
        ` ${pendingOps().length} pending${skipped ? `, ${skipped} bad line(s) skipped` : ""}`,
    );
}

// A round id names a PDA. A malformed one would send the authority to
// sign against an address we never meant — refused at the boundary,
// exactly like the outbox refuses an unpayable claim.
function isValidOp(op: RoundOp): boolean {
    if (op.kind !== "open" && op.kind !== "end") return false;
    if (!/^\d+$/.test(op.roundId) || op.roundId === "0") return false;
    if (op.kind === "open" && !/^\d+$/.test(op.endTimestamp ?? "")) return false;
    return true;
}

export function recordOp(op: RoundOp): void {
    if (!isValidOp(op)) {
        console.error(`[rounds] REFUSED malformed op ${JSON.stringify(op)} — not written`);
        return;
    }
    const key = opKey(op.kind, op.roundId);
    // Idempotent by construction: asking twice for the same operation is
    // the normal case (the manager re-checks its state every tick).
    if (ops.has(key)) return;
    ops.set(key, op);
    appendFileSync(ROUND_OPS_FILE, JSON.stringify({ type: "op", ...op } satisfies Line) + "\n");
    console.log(`[rounds] queued ${key}`);
}

export function ackOp(key: string, txSig: string): boolean {
    if (!ops.has(key)) return false; // unknown op: refuse
    if (acked.has(key)) return true; // duplicate ack: harmless
    acked.add(key);
    appendFileSync(
        ROUND_OPS_FILE,
        JSON.stringify({ type: "ack", key, txSig, at: Date.now() } satisfies Line) + "\n",
    );
    return true;
}

export function pendingOps(): RoundOp[] {
    const out: RoundOp[] = [];
    for (const [key, op] of ops) {
        if (!acked.has(key)) out.push(op);
    }
    return out;
}

// The highest round we have EVER asked to open, acked or not. This file
// is the manager's durable memory of "which successor did I already pick
// ?" — without it, a restart (or a slow confirmation) would recompute a
// successor from the clock, get a different slot, and open a SECOND
// round in parallel, splitting the liquidity in half.
export function latestOpenOp(): RoundOp | undefined {
    let latest: RoundOp | undefined;
    for (const op of ops.values()) {
        if (op.kind !== "open") continue;
        if (latest === undefined || BigInt(op.roundId) > BigInt(latest.roundId)) latest = op;
    }
    return latest;
}

// What the manager asks each tick: has this operation been requested,
// and has the chain confirmed it? "none" means nobody asked yet.
export function opState(kind: RoundOpKind, roundId: string): "none" | "pending" | "done" {
    const key = opKey(kind, roundId);
    if (!ops.has(key)) return "none";
    return acked.has(key) ? "done" : "pending";
}
