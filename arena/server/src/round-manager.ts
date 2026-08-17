// AF.1 — round rotation, Model A: a PERSISTENT WORLD whose escrow
// boundary moves without anyone noticing.
//
// THE RULE THAT SHAPES EVERYTHING: the end of a round is never a
// cash-out. Paying survivors when a round closes would be risk-free
// money for camping, which is exactly the botable behaviour this game
// cannot afford. EXTRACTION (12s channel, vulnerable) stays the only
// way to realise value, so a round is pure escrow bookkeeping and NO
// game is ever force-ended for the schedule's convenience.
//
// WHAT THE CHAIN ALREADY DOES FOR US (programs/arena/src/lib.rs) — this
// manager only orchestrates around three rules it does not implement:
//   join:              require!(now < end_timestamp)   -> past the
//     deadline the round accepts no new money. The "entry lock" of a
//     draining round is enforced on chain, not by our routing.
//   settle_extraction: requires state == Open, NOT the deadline -> a
//     player who extracts during the drain still gets paid.
//   end_round:         require!(now >= end_timestamp)  -> we cannot
//     close early, not even with the authority key.
// So OPEN / DRAINING / ENDED is not a state machine we invented; it is
// the program's own semantics, and this file follows it.
//
// THE INVARIANT: one room plays exactly one round (pinned in
// ArenaRoom.onCreate). PvP therefore only ever moves score INSIDE one
// vault, and per-vault solvency (A2.9) holds through a rotation.

import {
    forgetRound,
    knownRound,
    knownRounds,
    openRound,
    registerRound,
    setOpenRound,
} from "./chain";
import { unackedClaimCount } from "./outbox";
import { latestOpenOp, opState, recordOp } from "./round-ops";

// --- knobs ---------------------------------------------------------------
//
// Defaults are the PRODUCTION values. Short test values belong in .env
// (ROUND_DURATION_S=3600 etc.), never here: a forgotten test default is
// how a live deployment ends up rotating every hour.
const DURATION_S = Number(process.env.ROUND_DURATION_S || 24 * 3600);
// How long BEFORE a round's deadline its successor opens and takes over
// new deposits. Must comfortably exceed one typical run (~10 min), so
// that by the time the deadline lands, almost no room is still playing
// the old round.
const MARGIN_S = Number(process.env.ROTATION_MARGIN_S || 30 * 60);
// After the deadline, how long the stragglers still in a draining round
// may keep playing before the backstop closes their room.
const GRACE_S = Number(process.env.DRAIN_GRACE_S || 30 * 60);
// Rotation is minutes-scale: polling every 10s is free and keeps the
// logic a simple "look at the clock and converge" loop.
const TICK_MS = 10_000;
// The two warnings a room gets before the backstop kills it, as seconds
// REMAINING. Configurable so the whole drain can be watched in minutes
// during a test: with a short grace the production thresholds (10 min,
// 2 min) would both be already past at the deadline and fire together.
const WARN_AT_S = (process.env.DRAIN_WARN_AT_S || "600,120")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => b - a);

// --- what the manager needs from a room ---------------------------------

// Structural, so this module never imports ArenaRoom (that would be a
// cycle: ArenaRoom already imports this one).
export interface DrainableRoom {
    roomId: string;
    warnEndOfCycle(secondsLeft: number): void;
    forceCloseForDrain(): void;
}

// roundId (string) -> the rooms currently playing it.
const liveRooms = new Map<string, Map<string, DrainableRoom>>();
// Which warnings a given room has already heard, so a 10s tick does not
// spam the same banner 60 times.
const warned = new Map<string, Set<number>>();

export function roomOpened(roundId: bigint, room: DrainableRoom): void {
    const key = roundId.toString();
    let set = liveRooms.get(key);
    if (!set) liveRooms.set(key, (set = new Map()));
    set.set(room.roomId, room);
}

export function roomClosed(roundId: bigint, roomId: string): void {
    const key = roundId.toString();
    const set = liveRooms.get(key);
    if (!set) return;
    set.delete(roomId);
    warned.delete(roomId);
    if (set.size === 0) liveRooms.delete(key);
}

function liveRoomCount(roundId: string): number {
    return liveRooms.get(roundId)?.size ?? 0;
}

// --- round id derivation -------------------------------------------------

// THE ID MUST BE DETERMINISTIC. A round id IS a PDA seed, and an RPC
// timeout leaves us unsure whether initialize_round landed. If a retry
// derived a different id it would open a second round instead of
// discovering the first — two live vaults, split liquidity, and no way
// to tell which one a player meant to fund. So the id is a pure function
// of the clock: the start of the grid slot it falls in.
//
// It must also never REPEAT: end_round flips the state but leaves the
// Round account allocated, so re-initializing an old id fails forever.
// A monotonically advancing grid gives that for free.
function slotOf(unixS: number): number {
    return Math.floor(unixS / DURATION_S) * DURATION_S;
}

// ONLY for a round we are about to create: it is the deadline we choose.
// The deadline of an EXISTING round is read from its account
// (record.endTimestamp) — deriving it here would be wrong for any round
// not opened under the current DURATION_S, starting with every round
// opened by hand before AF.1 existed.
function plannedEndTs(roundId: bigint): number {
    return Number(roundId) + DURATION_S;
}

// The successor to open. Two guards on top of the plain grid:
//  - it must outlive `now` by at least half a round, or a migration from
//    a legacy (non-aligned) round would open a successor that expires
//    almost immediately;
//  - it must be strictly greater than the round it replaces (no PDA
//    reuse, ever).
function freshSlotAfter(floor: bigint | undefined, now: number): bigint {
    let slot = slotOf(now);
    while (slot + DURATION_S - now < DURATION_S / 2) slot += DURATION_S;
    let id = BigInt(slot);
    if (floor !== undefined) {
        while (id <= floor) id += BigInt(DURATION_S);
    }
    return id;
}

// WHICH round to open next — and the answer must be STABLE across
// ticks. The first version recomputed a fresh slot every 10 seconds and
// queued a second round while the first was still being confirmed
// (caught on the very first local run, 2026-08-17): two vaults open at
// once, liquidity split, exactly what the deterministic id was supposed
// to prevent. So: if we already committed to a successor, and it is
// still worth having, that decision stands.
//
// "Still worth having" is judged on the deadline WE ASKED FOR, recorded
// in the op file — a decision made hours ago by a process that has since
// restarted may point at a round that would already be expiring.
function chooseSuccessor(currentId: bigint | undefined, now: number): bigint {
    const last = latestOpenOp();
    if (!last) return freshSlotAfter(currentId, now);

    const lastId = BigInt(last.roundId);
    const viable = Number(last.endTimestamp) > now + MARGIN_S;
    const newer = currentId === undefined || lastId > currentId;
    if (viable && newer) return lastId;

    // Abandoning a committed successor: never reuse or step back onto
    // its id — that PDA may already exist on chain.
    const floor = currentId !== undefined && currentId > lastId ? currentId : lastId;
    return freshSlotAfter(floor, now);
}

// --- the loop ------------------------------------------------------------

let timer: NodeJS.Timeout | undefined;
let running = false;

export function startRoundManager(): void {
    if (process.env.ROUND_AUTOROTATE === "0") {
        console.log("[rounds] autorotation DISABLED (ROUND_AUTOROTATE=0)");
        return;
    }
    console.log(
        `[rounds] manager up — duration ${DURATION_S}s, rotate ${MARGIN_S}s early,` +
        ` drain grace ${GRACE_S}s`,
    );
    // unref: this timer must never be the reason the process stays alive.
    timer = setInterval(() => void tick(), TICK_MS);
    timer.unref?.();
    void tick();
}

export function stopRoundManager(): void {
    if (timer) clearInterval(timer);
    timer = undefined;
}

// One pass of "look at the clock and converge". Every branch is
// idempotent and re-entrant: whatever fails now is simply retried in
// 10 seconds, and the chain — not this process — remains the record of
// what actually happened.
async function tick(): Promise<void> {
    if (running) return; // an RPC round-trip may outlast one interval
    running = true;
    try {
        const now = Math.floor(Date.now() / 1000);
        await ensureOpenRound(now);
        await drainOldRounds(now);
    } catch (err) {
        // A rotation failure must degrade, never crash: the worst case is
        // that the current round keeps taking deposits a little longer,
        // and the ultimate floor is the existing free-only mode.
        console.error(`[rounds] tick failed (will retry): ${(err as Error).message}`);
    } finally {
        running = false;
    }
}

// Guarantees there is always a round accepting deposits — either because
// the current one is still comfortably alive, or because its successor
// has been opened and taken over. NEVER closes the door in between: the
// hand-off happens only once the new round is confirmed on chain.
async function ensureOpenRound(now: number): Promise<void> {
    const current = openRound();

    // Bootstrap: no round at all (fresh deployment, or ROUND_ID unset).
    // This is what ends the daily manual chore — the server opens its
    // own round instead of waiting for a human to paste an id into .env.
    if (!current) {
        await advanceTo(chooseSuccessor(undefined, now), undefined, undefined, now);
        return;
    }

    // The round's OWN deadline, straight from its account.
    const endTs = Number(current.endTimestamp);
    if (now < endTs - MARGIN_S) return; // nothing to do yet

    await advanceTo(chooseSuccessor(current.roundId, now), current.roundId, endTs, now);
}

// Request -> confirm -> adopt. Each state is re-evaluated from scratch
// every tick, so a crash anywhere resumes correctly.
async function advanceTo(
    successor: bigint,
    currentId: bigint | undefined,
    currentEndTs: number | undefined,
    now: number,
): Promise<void> {
    const key = successor.toString();
    switch (opState("open", key)) {
        case "none":
            recordOp({
                kind: "open",
                roundId: key,
                endTimestamp: String(plannedEndTs(successor)),
                at: Date.now(),
            });
            console.log(
                `[rounds] rotation: asked settlement to open round ${key}` +
                (currentEndTs !== undefined
                    ? ` (${currentEndTs - now}s left on ${currentId})`
                    : " (bootstrap)"),
            );
            return;

        case "pending":
            // The settlement service has not confirmed yet. The current
            // round stays open in the meantime — a moment of overlap is
            // harmless, a moment with NO open round is not.
            return;

        case "done": {
            // Confirmed on chain. Read it back before advertising it: the
            // op file says what we asked for, only the chain says what is
            // actually there (rake, treasury, real deadline).
            if (!knownRound(key)) {
                const reason = await registerRound(successor);
                if (reason) {
                    console.error(`[rounds] cannot adopt round ${key} yet — ${reason}`);
                    return;
                }
            }
            if (openRound()?.roundId !== successor) {
                setOpenRound(successor);
                console.log(
                    `[rounds] ROTATED — new deposits now fund ${key};` +
                    (currentId !== undefined ? ` round ${currentId} is DRAINING` : ""),
                );
            }
            return;
        }
    }
}

// Everything that is not the open round is draining: it takes no new
// rooms, its existing ones play out, and once it owes nothing and hosts
// nobody, its vault is swept and the round is closed for good.
async function drainOldRounds(now: number): Promise<void> {
    const openId = openRound()?.roundId;
    for (const round of knownRounds()) {
        if (round.roundId === openId) continue; // the live one is not draining
        const key = round.roundId.toString();
        const endTs = Number(round.endTimestamp); // its own, from the chain
        if (now < endTs) continue; // still inside its own deadline

        const rooms = liveRoomCount(key);
        const debts = unackedClaimCount(key);

        if (rooms > 0) {
            backstop(key, now, endTs);
            continue;
        }
        if (debts > 0) {
            // Never sweep a vault that still owes: end_round would take
            // the money those claims are meant to pay.
            console.log(`[rounds] round ${key} drained of rooms, waiting on ${debts} unsettled claim(s)`);
            continue;
        }

        switch (opState("end", key)) {
            case "none":
                recordOp({ kind: "end", roundId: key, at: Date.now() });
                console.log(`[rounds] round ${key} fully drained — asked settlement to end it`);
                break;
            case "pending":
                break;
            case "done":
                forgetRound(round.roundId);
                console.log(`[rounds] round ${key} ENDED and swept to the FoodReserve`);
                break;
        }
    }
}

// AF.1(f) — the backstop. A player who never extracts cannot hold a
// round open forever: after the grace period their room closes and the
// run ends in DEATH (corpse -> round economy -> swept to the
// FoodReserve). It is the only confiscation left in the design, and it
// is defensible — a full round plus a grace period plus two warnings,
// with extraction available the entire time. Paying them out instead
// would be the free cash-out the whole model forbids.
function backstop(roundId: string, now: number, endTs: number): void {
    const deadline = endTs + GRACE_S;
    const left = deadline - now;
    const rooms = liveRooms.get(roundId);
    if (!rooms) return;

    if (left <= 0) {
        console.warn(`[rounds] backstop: force-closing ${rooms.size} room(s) still on round ${roundId}`);
        for (const room of [...rooms.values()]) room.forceCloseForDrain();
        return;
    }

    for (const room of rooms.values()) {
        let seen = warned.get(room.roomId);
        if (!seen) warned.set(room.roomId, (seen = new Set()));
        for (const threshold of WARN_AT_S) {
            if (left <= threshold && !seen.has(threshold)) {
                seen.add(threshold);
                room.warnEndOfCycle(left);
            }
        }
    }
}
